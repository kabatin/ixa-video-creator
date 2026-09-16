'use client'

import type { MediaAssetId, Take, TakeId } from '@ixa/domain'
import { useEffect, useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import {
  formatSeconds,
  formatUsd,
  humanVerdictLabel,
  reviewStatusClassName,
  reviewStatusLabel,
} from '@/lib/shot-display'

export type TakeCardProps = {
  readonly take: Take
  readonly selected: boolean
  readonly busy: boolean
  readonly onSelect: (takeId: TakeId) => void
}

type UrlState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly url: string }
  | { readonly kind: 'error'; readonly message: string }

/**
 * 署名付き URL は state に置いたまま使い回さない。
 * 有効期限の 80% で捨てて取り直す（CLAUDE.md 規約 7）。
 */
const REFRESH_RATIO = 0.8

const useSignedUrl = (mediaAssetId: MediaAssetId): UrlState => {
  const [state, setState] = useState<UrlState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const load = async (): Promise<void> => {
      try {
        const issued = await createApiClient().mediaUrl(mediaAssetId)
        if (cancelled) return
        setState({ kind: 'ready', url: issued.url })
        timer = setTimeout(
          () => {
            void load()
          },
          issued.expiresInSec * REFRESH_RATIO * 1_000,
        )
      } catch (error) {
        if (cancelled) return
        setState({ kind: 'error', message: describeError(error) })
      }
    }

    void load()

    return () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [mediaAssetId])

  return state
}

const TakePreview = ({ state }: { readonly state: UrlState }) => {
  if (state.kind === 'loading') {
    return <div className="aspect-video w-full animate-pulse rounded bg-slate-200" />
  }
  if (state.kind === 'error') {
    return (
      <p role="alert" className="rounded bg-red-50 p-3 text-xs text-red-800">
        プレビューを取得できませんでした: {state.message}
      </p>
    )
  }
  return (
    <video
      controls
      preload="metadata"
      src={state.url}
      className="aspect-video w-full rounded bg-black"
    />
  )
}

export const TakeCard = ({ take, selected, busy, onSelect }: TakeCardProps) => {
  const urlState = useSignedUrl(take.mediaAssetId)

  return (
    <li
      aria-current={selected ? 'true' : undefined}
      className={`flex w-80 shrink-0 flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm ${
        selected ? 'border-emerald-500 ring-2 ring-emerald-500' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Take {take.index}</h3>
        {selected && (
          <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-white">
            採用中
          </span>
        )}
      </div>

      <TakePreview state={urlState} />

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
        <dt className="text-slate-400">モデル</dt>
        <dd className="truncate" title={take.modelId}>
          {take.modelId}
        </dd>
        <dt className="text-slate-400">seed</dt>
        <dd>{take.seedUsed === null ? '—' : take.seedUsed}</dd>
        <dt className="text-slate-400">コスト</dt>
        <dd>{formatUsd(take.costUsd)}</dd>
        <dt className="text-slate-400">生成時間</dt>
        <dd>{formatSeconds(take.generationTimeSec)}</dd>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${reviewStatusClassName(take.reviewStatus)}`}
        >
          {reviewStatusLabel(take.reviewStatus)}
        </span>
        <span className="text-xs text-slate-500">{humanVerdictLabel(take.humanVerdict)}</span>
      </div>

      <button
        type="button"
        disabled={busy || selected}
        onClick={() => {
          onSelect(take.id)
        }}
        className="mt-auto rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {selected ? '採用中' : '採用する'}
      </button>
    </li>
  )
}
