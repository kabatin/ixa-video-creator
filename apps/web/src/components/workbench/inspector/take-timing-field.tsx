'use client'

import type { Shot, Take } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { AutoSaveCheckbox } from '@/components/workbench/ui/auto-save-choice'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { FootageApi } from '@/lib/footage-api'
import { timingHint } from '@/lib/take-timing'

/**
 * 「Take を尺に合わせる」（ADR-0026）。採用 Take の長さから、いまの倍率と止まる長さを出す。
 * **「まだ読めていない」と「長さが無い」を混ぜない**（L-015）。読めなければそう言う。
 */
type Duration =
  | { readonly kind: 'none' }
  | { readonly kind: 'ready'; readonly sec: number | null }
  | { readonly kind: 'error'; readonly message: string }

export type TakeTimingFieldProps = {
  readonly shot: Pick<Shot, 'timing' | 'durationSec' | 'sourceInSec'>
  readonly adopted: Pick<Take, 'mediaAssetId'> | null
  readonly disabled?: boolean
  readonly onSave: (timing: Shot['timing']) => Promise<void>
  readonly api?: Pick<FootageApi, 'mediaDurationSec'>
}

export const TakeTimingField = ({ shot, adopted, disabled = false, onSave, api }: TakeTimingFieldProps) => {
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

  const hint = timingHint(shot, duration.kind === 'ready' ? duration.sec : null)
  return (
    <AutoSaveCheckbox
      label="Take を尺に合わせる（速度を変える）"
      checked={shot.timing === 'fit'}
      disabled={disabled}
      hint={duration.kind === 'error' ? `${hint} Take の長さを読めませんでした: ${duration.message}` : hint}
      onSave={(next) => onSave(next ? 'fit' : 'trim')}
    />
  )
}
