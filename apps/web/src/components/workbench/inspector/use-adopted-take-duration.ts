'use client'

import type { Take } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { FootageApi } from '@/lib/footage-api'

/**
 * 採用 Take の長さ。**「まだ読めていない」と「長さが無い」を混ぜない**（L-015）。読めなければそう言う。
 */
export type Duration =
  | { readonly kind: 'none' }
  | { readonly kind: 'ready'; readonly sec: number | null }
  | { readonly kind: 'error'; readonly message: string }

/** 採用 Take の長さ（秒）。速さの欄と「尺に合わせる」の欄が同じ読み方をする。 */
export const useAdoptedTakeDuration = (
  adopted: Pick<Take, 'mediaAssetId'> | null,
  api?: Pick<FootageApi, 'mediaDurationSec'>,
): Duration => {
  const client = useMemo(() => api ?? createApiClient(), [api])
  const [duration, setDuration] = useState<Duration>({ kind: 'none' })
  const mediaAssetId = adopted?.mediaAssetId ?? null

  useEffect(() => {
    if (mediaAssetId === null) {
      setDuration({ kind: 'none' })
      return
    }
    let alive = true
    client
      .mediaDurationSec(mediaAssetId)
      .then((sec) => {
        if (alive) setDuration({ kind: 'ready', sec })
      })
      .catch((cause: unknown) => {
        if (alive) setDuration({ kind: 'error', message: describeForPerson(cause) })
      })
    return () => {
      alive = false
    }
  }, [client, mediaAssetId])
  return duration
}

