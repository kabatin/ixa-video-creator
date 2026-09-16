import type { Seconds } from '../common/time.js'

/**
 * モデルが出せる尺の表現。
 * Veo は 4/6/8 秒、Kling は 5/10 秒しか出せない（ADR-0011）。
 */
export type DurationSupport =
  | { mode: 'enum'; values: readonly number[] }
  | { mode: 'range'; min: number; max: number; step?: number }

export class DurationNotSupportedError extends Error {
  constructor(readonly requested: Seconds, readonly support: DurationSupport) {
    super(
      `要求された尺 ${requested}s はこのモデルで出せません: ${JSON.stringify(support)}`,
    )
    this.name = 'DurationNotSupportedError'
  }
}

/**
 * 編集尺をモデルが出せる生成尺へ「切り上げる」。
 * 余りは Shot.sourceInSec でトリムし、トランジションののりしろにも使う。
 */
export const quantizeDuration = (
  requestedSec: Seconds,
  support: DurationSupport,
): Seconds => {
  if (support.mode === 'enum') {
    const candidates = [...support.values].sort((a, b) => a - b)
    const found = candidates.find((v) => v >= requestedSec)
    if (found === undefined) throw new DurationNotSupportedError(requestedSec, support)
    return found
  }

  if (requestedSec > support.max) throw new DurationNotSupportedError(requestedSec, support)
  const floor = Math.max(requestedSec, support.min)
  if (support.step === undefined) return floor
  const steps = Math.ceil((floor - support.min) / support.step)
  const value = support.min + steps * support.step
  if (value > support.max) throw new DurationNotSupportedError(requestedSec, support)
  return value
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
