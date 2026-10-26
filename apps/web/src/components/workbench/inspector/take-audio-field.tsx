'use client'

import { isTakeAudioMuted, type Shot } from '@ixa/domain'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { InfoTip } from '@/components/workbench/ui/collapsible-section'
import {
  TAKE_AUDIO_OPTIONS,
  formatTakeAudioVolume,
  parseTakeAudioChoice,
  parseTakeAudioVolume,
  takeAudioChoice,
  takeAudioHint,
  takeAudioVolumeProblem,
} from '@/lib/take-audio'

/**
 * 採用 Take の音（ADR-0060）。鳴らすかと大きさ。プレビューにも書き出しにも効く。
 * 既定は自動（セリフのある Shot だけ鳴らす）。MV の Shot は鳴らないまま、会話劇の Shot は鳴る。
 */
export type TakeAudioFieldProps = {
  readonly shot: Pick<Shot, 'takeAudioVolume' | 'takeAudioMuted' | 'dialogue'>
  readonly disabled?: boolean
  readonly onSave: (patch: { readonly takeAudioVolume?: number; readonly takeAudioMuted?: boolean | null }) => Promise<void>
}

export const TakeAudioField = ({ shot, disabled = false, onSave }: TakeAudioFieldProps) => (
  <div className="space-y-1.5">
    {/* 説明は ⓘ に畳む（2026-10-26。文は残し、押すと出す）。 */}
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <AutoSaveSelect
          label="Take の音"
          value={takeAudioChoice(shot.takeAudioMuted)}
          options={TAKE_AUDIO_OPTIONS}
          disabled={disabled}
          onSave={async (raw) => {
            const takeAudioMuted = parseTakeAudioChoice(raw)
            if (takeAudioMuted !== undefined) await onSave({ takeAudioMuted })
          }}
        />
      </div>
      <InfoTip label="Take の音">{takeAudioHint(shot)}</InfoTip>
    </div>
    <AutoSaveField
      label="Take の音の大きさ"
      value={formatTakeAudioVolume(shot.takeAudioVolume)}
      disabled={disabled || isTakeAudioMuted(shot)}
      validate={takeAudioVolumeProblem}
      onSave={async (raw) => {
        const takeAudioVolume = parseTakeAudioVolume(raw)
        if (takeAudioVolume !== null) await onSave({ takeAudioVolume })
      }}
    />
  </div>
)
