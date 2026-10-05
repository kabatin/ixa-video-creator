'use client'

import type {
  ProjectId,
  Shot,
  TimelineClip,
  TimelineClipId,
  TimelineTrack,
  Transition,
} from '@ixa/domain'
import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { InlineFormAnchor, InlineFormDraft } from '@/components/timeline-inline-form'
import { TEXT_INSERT_LAYER } from '@/components/timeline-tracks'
import { keepTextParams } from '@/lib/text-style-form'
import type { TimelineApi } from '@/lib/timeline-api'
import {
  probeTextInsertion,
  transitionInsertionPoints,
  validateTextClipInsert,
  validateTransitionInsert,
  type InsertIssue,
  type TransitionInsertionPoint,
} from '@/lib/timeline-insert'
import {
  textEditDraft,
  textInsertDraft,
  transitionDraft,
  type OpenInlineForm,
} from '@/lib/timeline-open-form'

export type TimelineInlineFormsDeps = {
  readonly api: TimelineApi
  readonly projectId: ProjectId
  readonly shots: readonly Shot[] | null
  readonly transitions: readonly Transition[] | null
  readonly clips: readonly TimelineClip[] | null
  readonly setTransitions: Dispatch<SetStateAction<readonly Transition[] | null>>
  readonly setClips: Dispatch<SetStateAction<readonly TimelineClip[] | null>>
  readonly durationSec: number
  /** 失敗を理由付きで出す実行の口（タイムラインの操作盤と同じ）。 */
  readonly run: (label: string, action: () => Promise<void>) => Promise<void>
  readonly setActionError: (message: string | null) => void
  readonly onOpenTextClip?: ((id: TimelineClipId) => void) | undefined
  /** 音のクリップ（効果音）を開く。渡せば帯の上の入力ではなくこちらで開く（ADR-0039）。 */
  readonly onOpenMediaClip?: ((id: TimelineClipId) => void) | undefined
  /** 新しいテロップを置く位置を寄せる（押した所の近くの拍・端へ。切ってあればそのまま）。 */
  readonly snapInsertAt: (atSec: number) => number
}

/**
 * 帯の上の入力（トランジションとテロップを置く・直す）。タイムラインの操作盤から切り出した（800 行の上限）。
 * 開いている入力・下書き・指摘と、開く・確定する・閉じる口を持つ。
 */
export const useTimelineInlineForms = ({
  api,
  projectId,
  shots,
  transitions,
  clips,
  setTransitions,
  setClips,
  durationSec,
  run,
  setActionError,
  onOpenTextClip,
  onOpenMediaClip,
  snapInsertAt,
}: TimelineInlineFormsDeps) => {
  /** 帯の上で開いている入力。開く場所が変わったら下書きも作り直す。 */
  const [open, setOpen] = useState<OpenInlineForm | null>(null)
  const [draft, setDraft] = useState<InlineFormDraft | null>(null)
  const [formIssues, setFormIssues] = useState<readonly InsertIssue[]>([])
  /**
   * 入力を開いた元のボタン。**閉じたら焦点をここへ戻す。**
   * 戻さないと、キーボードだけで操作している人が現在地を失って帯の先頭へ飛ばされる。
   * 戻すのは入力部品の仕事なので、こちらは受け口を渡すだけ。
   */
  const openerRef = useRef<HTMLElement | null>(null)


  const points = useMemo(
    () => transitionInsertionPoints(shots ?? [], transitions ?? []),
    [shots, transitions],
  )

  const closeForm = (): void => {
    setOpen(null)
    setDraft(null)
    setFormIssues([])
  }

  const openTransition = (
    point: TransitionInsertionPoint,
    anchor: InlineFormAnchor,
    opener: HTMLElement | null,
  ): void => {
    openerRef.current = opener
    setOpen({ kind: 'transition', point, anchor })
    setDraft(transitionDraft(point))
    setFormIssues([])
  }

  const openTextInsert = (
    track: TimelineTrack,
    atSec: number,
    anchor: InlineFormAnchor,
    opener: HTMLElement | null,
  ): void => {
    openerRef.current = opener
    const probeAt = (at: number) =>
      probeTextInsertion({
        clips: clips ?? [],
        track,
        layer: TEXT_INSERT_LAYER,
        atSec: at,
        programEndSec: durationSec,
      })
    // 押した所を拍へ寄せてから置く（制作者 2026-10-01「テロップ吸着繋ぎ」。引きずりと同じ規則）。
    // 寄せた所に置けなければ（隣のテロップに掛かる）、押した所に置く。
    const snapped = probeAt(snapInsertAt(atSec))
    const probe = snapped.ok ? snapped : probeAt(atSec)
    if (!probe.ok) {
      // **置けない理由を必ず出す。** 押しても何も出ないと、押せる場所が分からない。
      closeForm()
      setActionError(probe.message)
      return
    }
    setActionError(null)
    setOpen({ kind: 'text_insert', track, layer: TEXT_INSERT_LAYER, anchor })
    setDraft(textInsertDraft(probe))
    setFormIssues([])
  }

  const openClip = (
    clip: TimelineClip,
    anchor: InlineFormAnchor,
    opener: HTMLElement | null,
  ): void => {
    if (onOpenTextClip !== undefined && clip.content.type === 'text') {
      closeForm()
      onOpenTextClip(clip.id)
      return
    }
    if (onOpenMediaClip !== undefined && clip.content.type === 'media') {
      closeForm()
      onOpenMediaClip(clip.id)
      return
    }
    openerRef.current = opener
    setOpen({ kind: 'text_edit', clip, anchor })
    // 読めなかった値は `null` のまま渡す。断りは入力部品が出す。
    setDraft(textEditDraft(clip))
    setFormIssues([])
  }

  /**
   * トランジションは差し替えの口が無いので、**消してから作り直す**。
   * 2 つの Shot の間に 1 本、という不変条件を保ちやすいため（`timeline-api.ts`）。
   */
  const submitTransition = (point: TransitionInsertionPoint, next: InlineFormDraft): void => {
    if (next.kind !== 'transition') return
    const result = validateTransitionInsert(point, {
      type: next.type,
      durationSec: next.durationSec,
    })
    if (!result.ok) {
      setFormIssues(result.issues)
      return
    }
    const existing = point.existing
    void run(existing === null ? 'Transition を追加' : 'Transition を差し替え', async () => {
      if (existing !== null) {
        await api.deleteTransition(existing.id)
        setTransitions((current) =>
          current === null ? current : current.filter((t) => t.id !== existing.id),
        )
      }
      const created = await api.createTransition(projectId, result.value)
      setTransitions((current) => (current === null ? [created] : [...current, created]))
      closeForm()
    })
  }

  const submitTextClip = (next: InlineFormDraft, existing: TimelineClip | null): void => {
    if (next.kind !== 'text') return
    const track: TimelineTrack = existing?.track ?? 'TEXT'
    const layer = existing?.layer ?? TEXT_INSERT_LAYER
    const result = validateTextClipInsert({
      // 自分自身は重なりの相手にしない。直しているのだから当然ぶつかる。
      clips: (clips ?? []).filter((clip) => clip.id !== existing?.id),
      track,
      layer,
      programEndSec: durationSec,
      draft: {
        // 読めなかった値は `null` で来る。**検証へ渡す直前にだけ畳む。**
        // 早く畳むと「読めない」と「空」の区別が消える。
        templateKey: next.templateKey ?? '',
        text: next.text ?? '',
        startSec: next.startSec,
        durationSec: next.durationSec,
      },
    })
    if (!result.ok) {
      setFormIssues(result.issues)
      return
    }

    const value = result.value
    if (existing === null) {
      void run('テロップを追加', async () => {
        const created = await api.createClip(projectId, {
          track: value.track,
          startSec: value.startSec,
          durationSec: value.durationSec,
          layer: value.layer,
          content: {
            type: 'text',
            templateKey: value.templateKey,
            params: { ...value.params },
          },
        })
        setClips((current) => (current === null ? [created] : [...current, created]))
        closeForm()
        // 置いたらすぐ見た目・時間を直せるように、インスペクターで開く。
        onOpenTextClip?.(created.id)
      })
      return
    }

    void run('テロップを更新', async () => {
      const updated = await api.updateClip(existing.id, {
        startSec: value.startSec,
        durationSec: value.durationSec,
        content: {
          type: 'text',
          templateKey: value.templateKey,
          // 文字だけ新しくし、インスペクターで付けた見た目とスタイルは残す（ADR-0028）。
          params: keepTextParams(existing.content, value.params),
        },
      })
      setClips((current) =>
        current === null ? current : current.map((c) => (c.id === existing.id ? updated : c)),
      )
      closeForm()
    })
  }

  return {
    open,
    draft,
    formIssues,
    openerRef,
    points,
    closeForm,
    openTransition,
    openTextInsert,
    openClip,
    submitTransition,
    submitTextClip,
  }
}
