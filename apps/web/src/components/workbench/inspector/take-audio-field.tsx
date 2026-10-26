'use client'

import type { Shot } from '@ixa/domain'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { AutoSaveCheckbox } from '@/components/workbench/ui/auto-save-choice'
import { formatTakeAudioVolume, parseTakeAudioVolume, takeAudioVolumeProblem } from '@/lib/take-audio'

/**
 * 採用 Take の音（ADR-0060）。鳴らすかと大きさ。プレビューにも書き出しにも効く。
 * 前からある Shot は消音で始まる（今まで鳴らなかった MV は鳴らないまま）。会話劇の Shot は鳴らす。
 */
export type TakeAudioFieldProps = {
  readonly shot: Pick<Shot, 'takeAudioVolume' | 'takeAudioMuted'>
  readonly disabled?: boolean
  readonly onSave: (patch: { readonly takeAudioVolume?: number; readonly takeAudioMuted?: boolean }) => Promise<void>
}

export const TakeAudioField = ({ shot, disabled = false, onSave }: TakeAudioFieldProps) => (
  <div className="space-y-1.5">
    <AutoSaveCheckbox
      label="Take の音を鳴らす"
      checked={!shot.takeAudioMuted}
      disabled={disabled}
      hint={
        shot.takeAudioMuted
          ? 'いまは曲だけが鳴ります。セリフのある Shot は鳴らします。'
          : '音のある Take だけ鳴ります。鳴っている間は曲が下がります（曲を下げる設定のとき）。'
      }
      onSave={(next) => onSave({ takeAudioMuted: !next })}
    />
    <AutoSaveField
      label="Take の音の大きさ"
      value={formatTakeAudioVolume(shot.takeAudioVolume)}
      disabled={disabled || shot.takeAudioMuted}
      validate={takeAudioVolumeProblem}
      onSave={async (raw) => {
        const takeAudioVolume = parseTakeAudioVolume(raw)
        if (takeAudioVolume !== null) await onSave({ takeAudioVolume })
      }}
    />
  </div>
)
