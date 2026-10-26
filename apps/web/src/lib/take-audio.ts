import { MAX_TAKE_AUDIO_VOLUME, resolveMasteringMode, type MasteringMode, type ProjectMasteringMode } from '@ixa/domain'

/**
 * Take の音（ADR-0060）と、書き出しの仕上げの音量の言葉。**React を含まない。**
 * 決め方（鳴らすか・仕上げをどちらにするか）は domain と @ixa/timeline の 1 か所。ここは言葉にするだけ。
 */

const MAX_PERCENT = MAX_TAKE_AUDIO_VOLUME * 100

/** 大きさは割合で見せる（効果音の音量と同じ）。 */
export const formatTakeAudioVolume = (volume: number): string => `${String(Math.round(volume * 100))}%`

/** 割合（% は省いてよい）を大きさに戻す。0〜200% の外や数でないものは null（保存しない）。 */
export const parseTakeAudioVolume = (raw: string): number | null => {
  const trimmed = raw.trim().replace(/%$/u, '').trim()
  if (trimmed === '') return null
  const percent = Number(trimmed)
  return Number.isFinite(percent) && percent >= 0 && percent <= MAX_PERCENT ? percent / 100 : null
}

export const takeAudioVolumeProblem = (raw: string): string | null =>
  parseTakeAudioVolume(raw) === null ? `0〜${String(MAX_PERCENT)}% で入れてください` : null

export const MASTERING_OPTIONS: readonly { readonly value: MasteringMode; readonly label: string }[] = [
  { value: 'loudnorm', label: '全体をそろえる（今まで通り）' },
  { value: 'peak', label: '山だけ抑える' },
]

const labelOf = (mode: MasteringMode): string =>
  mode === 'peak' ? '山だけ抑える' : '全体をそろえる'

/** 選択欄に出す値。選んでいなければ、いま書き出すとどちらになるか（セリフの有無で決まる）。 */
export const masteringValue = (chosen: ProjectMasteringMode, hasDialogue: boolean): MasteringMode =>
  resolveMasteringMode(chosen, hasDialogue ? [{ dialogue: [null] }] : [])

/** 選択欄の下に出す一言。 */
export const masteringHint = (chosen: ProjectMasteringMode, hasDialogue: boolean): string => {
  if (chosen === null) {
    const reason = hasDialogue ? 'セリフのある Shot があるので' : 'セリフのある Shot が無いので'
    return `${reason}「${labelOf(masteringValue(null, hasDialogue))}」にしています。選ぶと、その後はセリフの有無で変えません。`
  }
  return chosen === 'peak'
    ? '音の山だけを抑えます。Take の声と曲の釣り合いはそのまま残ります。'
    : '書き出し全体の大きさを YouTube・SNS の基準にそろえます。'
}
