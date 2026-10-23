'use client'

import { isRetakeRecommended, type MediaAssetId, type Take, type TakeId } from '@ixa/domain'
import { useCallback, useEffect, useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { useRenewableMediaSrc } from '@/lib/use-renewable-media-src'
import { RETAKE_RECOMMENDED_HINT, RETAKE_RECOMMENDED_LABEL, reviewStatusClassName, reviewStatusLabel } from '@/lib/shot-display'
import type { MediaInfo } from '@/lib/take-display'
import {
  takeBytesLabel,
  takeCostLabel,
  takeModelLabel,
  takeResolutionLabel,
  takeTimeLabel,
} from '@/lib/take-display'
import type { ContextMenuTriggerProps } from '@/components/workbench/use-context-menu'
import type { ContextMenuItem } from '@/components/workbench/ui/context-menu'
import { MenuButton } from '@/components/workbench/ui/more-menu'

/** 画面に出す Take。API が決めた「作り直し推奨」を持てる（ADR-0057）。 */
export type TakeView = Take & { readonly retakeRecommended?: boolean }

export type TakeCardProps = {
  readonly take: TakeView
  readonly selected: boolean
  readonly busy: boolean
  readonly onSelect: (takeId: TakeId) => void
  /** 右クリック・長押し・Shift+F10 でこの Take のメニューを開く口。 */
  readonly contextMenu?: ContextMenuTriggerProps
  /** 「…」で開くメニューの行（右クリックと同じ中身）。渡さなければ「…」を出さない。 */
  readonly menuItems?: () => readonly ContextMenuItem[]
}

type UrlState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly url: string }
  | { readonly kind: 'error'; readonly message: string }

/**
 * 署名付き URL を取る。**時刻では取り直さない**（2026-10-18）。
 *
 * 以前は期限の 8 割（4 分）ごとに `src` を差し替えており、見ている途中の動画が 4 分ごとに頭へ戻った。
 * いまは読めなくなったときだけ取り直し、同じ位置から続ける（`TakePreview` の `useRenewableMediaSrc`）。
 */
const loadTakeUrl = async (mediaAssetId: MediaAssetId): Promise<string> =>
  (await createApiClient().mediaUrl(mediaAssetId)).url

const useSignedUrl = (mediaAssetId: MediaAssetId): UrlState => {
  const [state, setState] = useState<UrlState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    loadTakeUrl(mediaAssetId)
      .then((url) => {
        if (!cancelled) setState({ kind: 'ready', url })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: describeError(error) })
      })
    return () => {
      cancelled = true
    }
  }, [mediaAssetId])

  return state
}

/**
 * 素材の大きさと容量（制作者 2026-10-09）。
 *
 * **署名付き URL と別に引く。** あちらは期限があって取り直すが、こちらは変わらないので一度だけ。
 * 引けなくても比較は使えるので、`undefined` のまま黙って畳む（カードごと赤くしない）。
 */
const useMediaInfo = (mediaAssetId: MediaAssetId): MediaInfo | undefined => {
  const [info, setInfo] = useState<MediaInfo | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    // 別の Take へ切り替わったときに、前の素材の数字を出したままにしない。
    setInfo(undefined)
    void createApiClient()
      .mediaInfo(mediaAssetId)
      .then((loaded) => {
        if (!cancelled) setInfo(loaded)
      })
      .catch(() => {
        // 握り潰さない: 画面には「…」が残り、読めていないことが分かる。
      })
    return () => {
      cancelled = true
    }
  }, [mediaAssetId])

  return info
}

const TakePreview = ({
  state,
  mediaAssetId,
}: {
  readonly state: UrlState
  readonly mediaAssetId: MediaAssetId
}) => {
  const reload = useCallback(() => loadTakeUrl(mediaAssetId), [mediaAssetId])
  const video = useRenewableMediaSrc({
    url: state.kind === 'ready' ? state.url : null,
    reload,
    label: 'プレビュー',
  })
  if (state.kind === 'loading') {
    return <div className="aspect-video w-full animate-pulse rounded bg-line" />
  }
  if (state.kind === 'error') {
    return (
      <p role="alert" className="rounded bg-danger/10 p-3 text-xs text-danger">
        プレビューを取得できませんでした: {state.message}
      </p>
    )
  }
  return (
    <>
      {video.mediaProps !== null && (
        <video controls preload="metadata" {...video.mediaProps} className="aspect-video w-full rounded bg-black" />
      )}
      {video.error !== null && (
        <p role="alert" className="rounded bg-danger/10 p-2 text-xs text-danger">
          {video.error}
        </p>
      )}
    </>
  )
}

export const TakeCard = ({
  take,
  selected,
  busy,
  onSelect,
  contextMenu,
  menuItems,
}: TakeCardProps) => {
  const urlState = useSignedUrl(take.mediaAssetId)
  const mediaInfo = useMediaInfo(take.mediaAssetId)

  return (
    <li
      {...contextMenu}
      aria-current={selected ? 'true' : undefined}
      className={`flex w-80 shrink-0 flex-col gap-3 rounded-lg border bg-surface p-4 shadow-sm ${
        selected ? 'border-ok/40 ring-2 ring-ok/40' : 'border-line'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Take {take.index}</h3>
        <span className="flex items-center gap-1">
          {selected && (
            <span className="rounded-full bg-ok px-2.5 py-0.5 text-xs font-semibold text-bg">
              採用中
            </span>
          )}
          {menuItems !== undefined && (
            <MenuButton label={`Take ${String(take.index)} のその他の操作`} items={menuItems} />
          )}
        </span>
      </div>

      <TakePreview state={urlState} mediaAssetId={take.mediaAssetId} />

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted">
        <dt className="text-muted">モデル</dt>
        <dd className="truncate" title={takeModelLabel(take)}>
          {takeModelLabel(take)}
        </dd>
        <dt className="text-muted">seed</dt>
        <dd>{take.seedUsed === null ? '—' : take.seedUsed}</dd>
        <dt className="text-muted">コスト</dt>
        <dd>{takeCostLabel(take)}</dd>
        <dt className="text-muted">生成時間</dt>
        <dd>{takeTimeLabel(take)}</dd>
        <dt className="text-muted">大きさ</dt>
        <dd>{takeResolutionLabel(mediaInfo)}</dd>
        <dt className="text-muted">容量</dt>
        <dd>{takeBytesLabel(mediaInfo)}</dd>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${reviewStatusClassName(take.reviewStatus)}`}
        >
          {reviewStatusLabel(take.reviewStatus)}
        </span>
        {/* 不合格でも既定では自動で作り直さない（ADR-0057）。作り直すかは人が決める。 */}
        {(take.retakeRecommended ?? isRetakeRecommended(take, null)) && (
          <span title={RETAKE_RECOMMENDED_HINT} className="rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-bg">
            {RETAKE_RECOMMENDED_LABEL}
          </span>
        )}
        {/* 「人手未確認 / 人手承認」は出さない。採用が決定で、別の承認は無い（ADR-0023）。 */}
      </div>

      <button
        type="button"
        disabled={busy || selected}
        onClick={() => {
          onSelect(take.id)
        }}
        className="mt-auto rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
      >
        {selected ? '採用中' : '採用する'}
      </button>
    </li>
  )
}
