'use client'

import type { EffectTemplateKey, ProjectId, TimelineClip, TimelineClipId } from '@ixa/domain'
import { defaultEffectParams } from '@ixa/domain'
import { useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { EFFECT_PICKER_OPTIONS, EFFECT_TRACK, planEffectInsert } from '@/lib/effect-clip'
import { formatClock } from '@/lib/format-time'
import { usePlayheadSec } from '@/lib/playhead-sec'
import type { TimelineApi } from '@/lib/timeline-api'
import {
  INLINE_PANEL_MARGIN_PX,
  clampInlinePanelPosition,
  type InlineFormAnchor,
  type InlinePanelPlacement,
} from '@/lib/timeline-inline-form'

/**
 * エフェクトを置く（ADR-0050）。帯の VFX を押すか「＋ エフェクト」（再生位置）で、型を選ぶ小窓を開く。
 * 置いたらインスペクターで開き、そこで強さを直す。**文から絵を作らない。** 決まった型を選ぶだけ。
 */

export type EffectPickerState = { readonly atSec: number; readonly anchor: InlineFormAnchor }

export type EffectInsertDeps = {
  readonly api: TimelineApi
  readonly projectId: ProjectId
  readonly clips: readonly TimelineClip[] | null
  readonly setClips: Dispatch<SetStateAction<readonly TimelineClip[] | null>>
  readonly durationSec: number
  readonly run: (label: string, action: () => Promise<void>) => Promise<void>
  readonly setActionError: (message: string | null) => void
  readonly onOpenEffectClip?: ((id: TimelineClipId) => void) | undefined
  /** 置く位置を寄せる（押した所の近くの拍・端へ。テロップと同じ規則）。 */
  readonly snapInsertAt: (atSec: number) => number
}

export const useEffectInsert = (deps: EffectInsertDeps) => {
  const [picker, setPicker] = useState<EffectPickerState | null>(null)

  const close = (): void => {
    setPicker(null)
  }

  const openAt = (atSec: number, anchor: InlineFormAnchor): void => {
    deps.setActionError(null)
    setPicker({ atSec: deps.snapInsertAt(atSec), anchor })
  }

  const place = (templateKey: EffectTemplateKey): void => {
    if (picker === null) return
    const plan = planEffectInsert({ clips: deps.clips ?? [], templateKey, atSec: picker.atSec, programEndSec: deps.durationSec })
    if (!plan.ok) {
      // **置けない理由を必ず出す。** 押しても何も起きないと、どこなら置けるのか分からない。
      close()
      deps.setActionError(plan.message)
      return
    }
    void deps.run('エフェクトを追加', async () => {
      const created = await deps.api.createClip(deps.projectId, {
        track: EFFECT_TRACK,
        startSec: plan.startSec,
        durationSec: plan.durationSec,
        layer: plan.layer,
        content: { type: 'motion_graphics', templateKey, params: { ...defaultEffectParams(templateKey) } },
      })
      deps.setClips((current) => (current === null ? [created] : [...current, created]))
      close()
      // 置いたらすぐ強さを直せるように、インスペクターで開く。
      deps.onOpenEffectClip?.(created.id)
    })
  }

  return { picker, openAt, close, place }
}

const samePlacement = (a: InlinePanelPlacement, b: InlinePanelPlacement): boolean =>
  a.leftPx === b.leftPx && a.topPx === b.topPx && a.placedAbove === b.placedAbove

/** 型を選ぶ小窓。押した型をその場に置く。Esc・外で閉じる。 */
export const EffectPicker = ({
  state,
  busy,
  onPick,
  onDismiss,
}: {
  readonly state: EffectPickerState
  readonly busy: boolean
  readonly onPick: (key: EffectTemplateKey) => void
  readonly onDismiss: () => void
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<InlinePanelPlacement>({ ...state.anchor, placedAbove: false })

  useLayoutEffect(() => {
    panelRef.current?.querySelector('button')?.focus()
  }, [])

  // 画面からはみ出さない場所へ寄せる（帯の上の入力と同じ規則）。
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel || panel.offsetWidth === 0) return
    const next = clampInlinePanelPosition(
      state.anchor,
      { widthPx: panel.offsetWidth, heightPx: panel.offsetHeight },
      { widthPx: window.innerWidth, heightPx: window.innerHeight },
    )
    setPlacement((current) => (samePlacement(current, next) ? current : next))
  })

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="エフェクトを選んで置く"
      onKeyDown={(event) => {
        // 打鍵を外へ流さない（外には再生・区切りの割り当てがある）。
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          onDismiss()
        }
      }}
      onBlurCapture={(event) => {
        if (!(panelRef.current?.contains(event.relatedTarget) ?? false)) onDismiss()
      }}
      style={{
        position: 'fixed',
        left: `${String(placement.leftPx)}px`,
        top: `${String(placement.topPx)}px`,
        maxHeight: `calc(100vh - ${String(INLINE_PANEL_MARGIN_PX * 2)}px)`,
        overflowY: 'auto',
      }}
      className="z-50 w-72 rounded-lg border border-line-strong bg-surface p-3 shadow-lg"
    >
      <p className="text-sm font-semibold text-text">エフェクトを置く</p>
      <p className="text-xs text-muted">{`${formatClock(state.atSec)} から`}</p>
      <ul className="mt-2 space-y-1">
        {EFFECT_PICKER_OPTIONS.map((option) => (
          <li key={option.key}>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onPick(option.key)
              }}
              className="w-full rounded-md px-2 py-1 text-left hover:bg-surface-2 focus:bg-surface-2 disabled:opacity-50"
            >
              <span className="block text-sm text-text">{option.label}</span>
              <span className="block text-xs text-muted">{option.hint}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onDismiss} className="mt-2 text-xs text-muted hover:text-text">
        やめる
      </button>
    </div>,
    document.body,
  )
}

/** 「＋ エフェクト」。**再生位置に置く。** 位置は押した時点の値を読む（`@/lib/playhead-sec`）。 */
export const AddEffectButton = ({
  busy,
  onOpen,
}: {
  readonly busy: boolean
  readonly onOpen: (atSec: number, anchor: InlineFormAnchor) => void
}) => {
  const playheadSec = usePlayheadSec()
  return (
    <button
      type="button"
      disabled={busy}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        onOpen(playheadSec, { leftPx: rect.left + rect.width / 2, topPx: rect.bottom })
      }}
      className="rounded-md bg-surface px-3 py-1 text-sm text-text ring-1 ring-line-strong hover:bg-surface-2 disabled:opacity-50"
      title="再生位置にエフェクト（フラッシュ・寄りのパンチ・揺れなど）を置きます"
    >
      ＋ エフェクト
    </button>
  )
}
