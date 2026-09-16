'use client'

import type { MediaAssetId } from '@ixa/domain'
import { useEffect, useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'

export type MediaImageProps = {
  readonly mediaAssetId: MediaAssetId
  readonly alt: string
  readonly className?: string
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

/** 参照画像のプレビュー。URL は都度発行し、画面を離れたら取り直しを止める。 */
export const MediaImage = ({ mediaAssetId, alt, className }: MediaImageProps) => {
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

  const frame = className ?? 'aspect-square w-full rounded object-cover'

  if (state.kind === 'loading') {
    return <div className={`${frame} animate-pulse bg-slate-200`} />
  }

  if (state.kind === 'error') {
    return (
      <p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-800">
        画像を取得できませんでした: {state.message}
      </p>
    )
  }

  // 署名付き URL は毎回変わるため、next/image の最適化対象にせず素の img で表示する。
  return <img src={state.url} alt={alt} className={`${frame} bg-slate-100`} />
}
