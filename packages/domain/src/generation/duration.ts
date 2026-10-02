import type { Seconds } from '../common/time.js'

/**
 * モデルが出せる尺の表現。
 * Veo は 4/6/8 秒、Kling は 5/10 秒しか出せない（ADR-0011）。
 */
export type DurationSupport =
  | { mode: 'enum'; values: readonly number[] }
  | { mode: 'range'; min: number; max: number; step?: number }

/**
 * 最長より長い Shot を、最長で作ってゆっくり再生で埋めるのはこの倍率まで（制作者 2026-10-02「Shot 分け判定は
 * 2 倍ではなく 1.5 倍にしましょう」）。それより長い Shot は分けてもらう。
 * 再生の「Take を尺に合わせる」の幅（`MIN_PLAYBACK_RATE` = 0.5 倍まで。ADR-0026）とは別の値で、こちらの方が狭い。
 */
export const MAX_GENERATION_STRETCH = 1.5

/** 画面と同じ書き方（`3.75`・`10.125`）。末尾の 0 は付けない。 */
const secondsText = (value: number): string => String(Number(value.toFixed(3)))

/** そのモデルが出せる最も長い尺。step 付きの範囲では、step に載る最後の値。 */
export const longestDuration = (support: DurationSupport): Seconds => {
  if (support.mode === 'enum') return Math.max(...support.values)
  if (support.step === undefined) return support.max
  return support.min + Math.floor((support.max - support.min) / support.step) * support.step
}

export class DurationNotSupportedError extends Error {
  constructor(readonly requested: Seconds, readonly support: DurationSupport) {
    const longest = longestDuration(support)
    super(
      `Shot の尺 ${secondsText(requested)} 秒は、このモデルの最長 ${secondsText(longest)} 秒の ` +
        `${String(MAX_GENERATION_STRETCH)} 倍を超えます（最長で作ってゆっくり再生で埋めるのは ${String(MAX_GENERATION_STRETCH)} 倍の長さまで）。` +
        `Shot を分けてください。`,
    )
    this.name = 'DurationNotSupportedError'
  }
}

/**
 * 編集尺をモデルが出せる生成尺へ「切り上げる」。
 * 余りは Shot.sourceInSec でトリムし、トランジションののりしろにも使う。
 *
 * **最長より長い Shot は最長で作る**（制作者 2026-10-01「ミリ秒まで一致しないと作れないのは不便すぎる」）。
 * 足りない分は「Take を尺に合わせる」（`Shot.timing = 'fit'`）でゆっくり再生して埋める。
 * 伸ばすのは最長の `MAX_GENERATION_STRETCH` 倍（1.5 倍）の尺まで。それより長ければ断る。
 */
export const quantizeDuration = (
  requestedSec: Seconds,
  support: DurationSupport,
): Seconds => {
  const longest = longestDuration(support)
  if (requestedSec > longest) {
    if (requestedSec > longest * MAX_GENERATION_STRETCH) {
      throw new DurationNotSupportedError(requestedSec, support)
    }
    return longest
  }

  if (support.mode === 'enum') {
    const candidates = [...support.values].sort((a, b) => a - b)
    return candidates.find((v) => v >= requestedSec) ?? longest
  }

  const floor = Math.max(requestedSec, support.min)
  if (support.step === undefined) return floor
  const steps = Math.ceil((floor - support.min) / support.step)
  return Math.min(support.min + steps * support.step, longest)
}

export const canProduceDuration = (
  requestedSec: Seconds,
  support: DurationSupport,
): boolean => {
  try {
    quantizeDuration(requestedSec, support)
    return true
  } catch {
    return false
  }
}

/** 生成尺が編集尺に足りず、ゆっくり再生して埋めるか（`Shot.timing` を `fit` にする）。 */
export const stretchesToFit = (editDurationSec: Seconds, generationDurationSec: Seconds): boolean =>
  generationDurationSec < editDurationSec

/**
 * 生成尺が編集尺を上回るとき、どこからトリムするか。
 * 動画生成モデルは冒頭 0.1〜0.3 秒が不安定なため、先頭を少し捨てる方が歩留まりが良い。
 * ただし start_frame を指定した場合は冒頭が最も安定するため 0 にする。
 */
export const HEAD_TRIM_MAX_SEC = 0.15

export const defaultSourceInSec = (
  generationDurationSec: Seconds,
  editDurationSec: Seconds,
  hasStartFrame: boolean,
): Seconds => {
  if (hasStartFrame) return 0
  const slack = generationDurationSec - editDurationSec
  if (slack <= 0) return 0
  return Math.min(HEAD_TRIM_MAX_SEC, slack / 2)
}
