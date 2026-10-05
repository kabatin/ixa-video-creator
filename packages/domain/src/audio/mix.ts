import { z } from 'zod'

/**
 * 音の仕上げ（ADR-0039）。ナレーションが鳴る間は BGM を下げる（ダッキング）。曲・効果音の頭と終わりはフェードする。
 *
 * プレビューと書き出しで同じ音になるよう、**時刻 → 音量の倍率**の純関数にしておく。
 * 描く側（Remotion の `volume`、ffmpeg の式）は、これを 1 コマごとに呼ぶか、同じ形を写す。
 */

/** 下げ幅（dB）。画面では「弱・中・強」で選ぶ。 */
export const DUCKING_DEPTH_DB = { weak: 6, medium: 10, strong: 16 } as const

export const DuckingSettings = z.object({
  enabled: z.boolean().default(true),
  /** 下げ幅（dB）。 */
  depthDb: z.number().min(0).max(24).default(DUCKING_DEPTH_DB.medium),
  /** 声の少し前から下げ始める長さ（最初の音が BGM に埋もれない）。 */
  attackSec: z.number().min(0).max(2).default(0.15),
  /** 声の後で戻す長さ。 */
  releaseSec: z.number().min(0).max(2).default(0.4),
})
export type DuckingSettings = z.infer<typeof DuckingSettings>

export type VoiceSpan = { readonly startSec: number; readonly endSec: number }

export const dbToGain = (db: number): number => 10 ** (db / 20)

/**
 * 声の鳴る区間を並べてまとめる。重なる区間と、下げて戻すより短い隙間（立ち上がり + 戻り）はつなぐ。
 * 行の間の短い隙間で BGM が上下すると、うるさく聞こえるため。
 */
export const mergeVoiceSpans = (spans: readonly VoiceSpan[], settings: DuckingSettings): readonly VoiceSpan[] =>
  [...spans]
    .sort((a, b) => a.startSec - b.startSec)
    .reduce<readonly VoiceSpan[]>((merged, span) => {
      const last = merged.at(-1)
      return last !== undefined && span.startSec - last.endSec < settings.attackSec + settings.releaseSec
        ? [...merged.slice(0, -1), { startSec: last.startSec, endSec: Math.max(last.endSec, span.endSec) }]
        : [...merged, span]
    }, [])

/** 0..1 に収める。 */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** 1 つの区間に対する倍率。前で下げ始め、区間の間は下げたまま、後で戻す。 */
const gainForSpan = (t: number, span: VoiceSpan, low: number, settings: DuckingSettings): number => {
  if (t >= span.startSec && t <= span.endSec) return low
  if (t < span.startSec) {
    const progress = settings.attackSec === 0 ? 0 : clamp01((t - (span.startSec - settings.attackSec)) / settings.attackSec)
    return 1 + (low - 1) * progress
  }
  const progress = settings.releaseSec === 0 ? 1 : clamp01((t - span.endSec) / settings.releaseSec)
  return low + (1 - low) * progress
}

/** BGM の音量の倍率（0..1）。`spans` は `mergeVoiceSpans` でまとめたもの。いちばん下げる区間に合わせる。 */
export const duckingGainAt = (t: number, spans: readonly VoiceSpan[], settings: DuckingSettings): number => {
  if (!settings.enabled) return 1
  const low = dbToGain(-settings.depthDb)
  return spans.reduce((gain, span) => Math.min(gain, gainForSpan(t, span, low, settings)), 1)
}

export type FadeShape = {
  readonly startSec: number
  readonly durationSec: number
  readonly fadeInSec: number
  readonly fadeOutSec: number
}

/** フェードの倍率（0..1）。頭は 0 → 1、終わりは 1 → 0 の直線。区間の外は 0。重なるときは小さいほう。 */
export const fadeGainAt = (t: number, shape: FadeShape): number => {
  const endSec = shape.startSec + shape.durationSec
  if (t < shape.startSec || t > endSec) return 0
  const fadeIn = shape.fadeInSec <= 0 ? 1 : clamp01((t - shape.startSec) / shape.fadeInSec)
  const fadeOut = shape.fadeOutSec <= 0 ? 1 : clamp01((endSec - t) / shape.fadeOutSec)
  return Math.min(fadeIn, fadeOut)
}
