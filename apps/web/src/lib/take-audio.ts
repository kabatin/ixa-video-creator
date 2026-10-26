import {
  MAX_TAKE_AUDIO_VOLUME,
  MasteringMode,
  isTakeAudioMuted,
  resolveMasteringMode,
  type ProjectMasteringMode,
  type Shot,
} from '@ixa/domain'

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

type TakeAudioShot = Pick<Shot, 'takeAudioMuted' | 'dialogue'>

/** Take の音を鳴らすかの選択肢（null = 自動は、セリフのある Shot だけ鳴らす）。 */
export const TAKE_AUDIO_OPTIONS: readonly { readonly value: 'auto' | 'on' | 'off'; readonly label: string }[] = [
  { value: 'auto', label: '自動（セリフがあれば鳴らす）' },
  { value: 'on', label: '鳴らす' },
  { value: 'off', label: '鳴らさない' },
]

export const takeAudioChoice = (muted: boolean | null): 'auto' | 'on' | 'off' =>
  muted === null ? 'auto' : muted ? 'off' : 'on'

/** 選択肢を保存する値に戻す。知らない値は undefined（保存しない）。 */
export const parseTakeAudioChoice = (raw: string): boolean | null | undefined =>
  raw === 'auto' ? null : raw === 'on' ? false : raw === 'off' ? true : undefined

/** 選択欄の下の一言。自動のときは、いまどうなっているかと理由。 */
export const takeAudioHint = (shot: TakeAudioShot): string => {
  if (shot.takeAudioMuted === null) {
    return shot.dialogue.length > 0 ? 'いまは鳴らします（セリフがあるため）。' : 'いまは鳴らしません（セリフが無いため）。'
  }
  return isTakeAudioMuted(shot)
    ? '曲だけが鳴ります。'
    : '音のある Take だけ鳴ります。鳴っている間は曲が下がります（曲を下げる設定のとき）。'
}

type MasteringChoice = MasteringMode | 'auto'

export const MASTERING_OPTIONS: readonly { readonly value: MasteringChoice; readonly label: string }[] = [
  { value: 'auto', label: '自動（おすすめ）' },
  { value: 'loudnorm', label: '全体をそろえる（今まで通り）' },
  { value: 'peak', label: '山だけ抑える' },
]

const labelOf = (mode: MasteringMode): string =>
  mode === 'peak' ? '山だけ抑える' : '全体をそろえる'

/** 選択欄に出す値。選んでいなければ自動。 */
export const masteringValue = (chosen: ProjectMasteringMode): MasteringChoice => chosen ?? 'auto'

/** 選択肢を保存する値に戻す（自動は null）。知らない値は undefined（保存しない）。 */
export const parseMasteringChoice = (raw: string): ProjectMasteringMode | undefined => {
  if (raw === 'auto') return null
  const parsed = MasteringMode.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

/**
 * 選択欄の下に出す一言。自動のときは、いま書き出すとどちらになるかと理由（決め方は domain の `resolveMasteringMode`）。
 * `takeAudioAudible` はタイムラインに Take の音を鳴らす Shot があるか。読めていなければ null。
 */
export const masteringHint = (chosen: ProjectMasteringMode, takeAudioAudible: boolean | null): string => {
  if (chosen === null) {
    if (takeAudioAudible === null) {
      return 'Take の音を鳴らす Shot があれば「山だけ抑える」、無ければ「全体をそろえる」になります。'
    }
    const reason = takeAudioAudible ? 'Take の音を鳴らす Shot があるため' : 'Take の音を鳴らす Shot が無いため'
    return `いまは「${labelOf(resolveMasteringMode(null, takeAudioAudible))}」になります（${reason}）。`
  }
  return chosen === 'peak'
    ? '音の山だけを抑えます。Take の声と曲の釣り合いはそのまま残ります。'
    : '書き出し全体の大きさを YouTube・SNS の基準にそろえます。'
}
