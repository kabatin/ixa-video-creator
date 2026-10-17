'use client'

import type { Shot, Take } from '@ixa/domain'
import { AutoSaveCheckbox } from '@/components/workbench/ui/auto-save-choice'
import { useAdoptedTakeDuration } from '@/components/workbench/inspector/use-adopted-take-duration'
import type { FootageApi } from '@/lib/footage-api'
import { timingHint } from '@/lib/take-timing'

/** 「Take を尺に合わせる」（ADR-0026）。採用 Take の長さから、いまの倍率と止まる長さを出す。 */
export type TakeTimingFieldProps = {
  readonly shot: Pick<Shot, 'timing' | 'durationSec' | 'sourceInSec'>
  readonly adopted: Pick<Take, 'mediaAssetId'> | null
  readonly disabled?: boolean
  readonly onSave: (timing: Shot['timing']) => Promise<void>
  readonly api?: Pick<FootageApi, 'mediaDurationSec'>
}

export const TakeTimingField = ({ shot, adopted, disabled = false, onSave, api }: TakeTimingFieldProps) => {
  const duration = useAdoptedTakeDuration(adopted, api)
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
