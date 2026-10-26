'use client'

import type { Shot, Take } from '@ixa/domain'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { InfoTip } from '@/components/workbench/ui/collapsible-section'
import { useAdoptedTakeDuration } from '@/components/workbench/inspector/use-adopted-take-duration'
import { formatClock } from '@/lib/format-time'
import type { FootageApi } from '@/lib/footage-api'
import { parseSpeed, speedHint, speedOptions } from '@/lib/take-speed'
import { parseClockInput } from '@/lib/time-input'

/**
 * Shot の速さと、Take のどこから使うか（ADR-0050）。予告編の速い編集のため、畳まずに出す。
 * `fit` の間も選べる。AI に頼む長さが尺 × 速さになり、再生はその Take が尺に収まる速さになる（2026-10-24）。
 */
export type TakeSpeedFieldProps = {
  readonly shot: Pick<Shot, 'timing' | 'durationSec' | 'sourceInSec' | 'speed'>
  readonly adopted: Pick<Take, 'mediaAssetId'> | null
  readonly disabled?: boolean
  readonly onSave: (patch: { readonly speed?: number; readonly sourceInSec?: number }) => Promise<void>
  readonly api?: Pick<FootageApi, 'mediaDurationSec'>
}

export const TakeSpeedField = ({ shot, adopted, disabled = false, onSave, api }: TakeSpeedFieldProps) => {
  const duration = useAdoptedTakeDuration(adopted, api)
  const takeSec = duration.kind === 'ready' ? duration.sec : null
  /** 使い始めは Take の中の位置。Take の長さが分かっていれば、それより手前だけを受ける。 */
  const validateStart = (raw: string): string | null => {
    const sec = parseClockInput(raw)
    if (sec === null) return '0:00.50 や 0.5 の形で入れてください'
    if (takeSec !== null && sec >= takeSec) return 'Take の長さより手前を入れてください'
    return null
  }
  return (
    <div className="space-y-1.5">
      {/* 説明は ⓘ に畳む（2026-10-26。文は残し、押すと出す）。 */}
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <AutoSaveSelect
            label="速さ"
            value={String(shot.speed)}
            options={speedOptions(shot.speed)}
            disabled={disabled}
            onSave={async (raw) => {
              const speed = parseSpeed(raw)
              if (speed !== null) await onSave({ speed })
            }}
          />
        </div>
        <InfoTip label="速さ">{speedHint(shot, takeSec)}</InfoTip>
      </div>
      <AutoSaveField
        label="使い始め"
        value={formatClock(shot.sourceInSec)}
        disabled={disabled}
        validate={validateStart}
        onSave={async (raw) => {
          const sourceInSec = parseClockInput(raw)
          if (sourceInSec !== null) await onSave({ sourceInSec })
        }}
      />
    </div>
  )
}
