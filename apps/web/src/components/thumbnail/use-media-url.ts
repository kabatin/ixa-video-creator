'use client'

import type { MediaAssetId } from '@ixa/domain'
import { useEffect, useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'

export type MediaUrlState =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly url: string }
  | { readonly kind: 'error'; readonly message: string }

/** 期限の 8 割で取り直す（`media-image.tsx` と同じ。署名付き URL を使い回さない。規約 7）。 */
const REFRESH_RATIO = 0.8

/** 素材の署名付き URL。null なら何もしない。URL は state の外へ出さない。 */
export const useMediaUrl = (mediaAssetId: MediaAssetId | null): MediaUrlState => {
  const [state, setState] = useState<MediaUrlState>({ kind: mediaAssetId === null ? 'none' : 'loading' })

  useEffect(() => {
    if (mediaAssetId === null) {
      setState({ kind: 'none' })
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    setState({ kind: 'loading' })

    const load = async (): Promise<void> => {
      try {
        const issued = await createApiClient().mediaUrl(mediaAssetId)
        if (cancelled) return
        setState({ kind: 'ready', url: issued.url })
        timer = setTimeout(() => {
          void load()
        }, issued.expiresInSec * REFRESH_RATIO * 1_000)
      } catch (error) {
        if (!cancelled) setState({ kind: 'error', message: describeError(error) })
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
