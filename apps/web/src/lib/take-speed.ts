import type { Shot } from '@ixa/domain'
import { MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE, requestedSourceSec } from '@ixa/domain'
import { shotPlaybackRate } from '@ixa/timeline'
import { formatDuration } from '@/lib/format-time'

/**
 * Shot の速さ（ADR-0050）の言葉。**React を含まない。**
 * 速さそのものの決め方は domain の `shotPlaybackRate` / `requestedSourceSec` の 1 か所（プレビュー・書き出しと同じ）。
 */
type SpeedShot = Pick<Shot, 'timing' | 'durationSec' | 'sourceInSec' | 'speed'>

/** よく使う速さ。予告編の速い編集は 1.25〜2 倍、余韻は 0.75 倍。 */
const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5] as const

const label = (value: number): string => (value === 1 ? '1 倍（そのまま）' : `${String(value)} 倍`)

/** 選択肢。いまの値が一覧に無ければ（MCP などで細かく決めた値）それも並べる。 */
export const speedOptions = (current: number): readonly { readonly value: string; readonly label: string }[] => {
  const values = PRESETS.some((value) => value === current) ? [...PRESETS] : [...PRESETS, current].sort((a, b) => a - b)
  return values.map((value) => ({ value: String(value), label: label(value) }))
}

/** 選択肢の値を速さに戻す。範囲の外や数でないものは null（保存しない）。 */
export const parseSpeed = (raw: string): number | null => {
  const value = Number(raw)
  return Number.isFinite(value) && value >= MIN_PLAYBACK_RATE && value <= MAX_PLAYBACK_RATE ? value : null
}

const rate = (value: number): string => `${value.toFixed(2)} 倍`

/** 速さの欄の下に出す一言。 */
export const speedHint = (shot: SpeedShot, takeDurationSec: number | null): string => {
  if (shot.timing === 'fit') return '「Take を尺に合わせる」の間は、速さは Take の長さで決まります。'
  const asks = `AI には ${formatDuration(requestedSourceSec(shot))} で頼みます。`
  if (shot.speed === 1) return '1 倍より速くすると、短いカットでも動きが詰まって見えます。'
  if (takeDurationSec === null) return asks
  const actual = shotPlaybackRate(shot, takeDurationSec)
  if (actual + 0.005 >= shot.speed) return asks
  return `いまの Take では長さが足りないので ${rate(actual)}で流しています（作り直すと ${formatDuration(requestedSourceSec(shot))} で頼みます）。`
}
