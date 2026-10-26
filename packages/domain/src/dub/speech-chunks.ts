/**
 * 声の区間（ADR-0062）。音を 10ms 刻みの RMS（dB）にした列から、話している区間を拾う純粋関数。
 * 値は AnimalVideo で実際に動いている作り（16kHz・窓 400・刻み 160 の RMS）。
 */

/** 声の区間（秒）。end は含まない。 */
export type DubChunk = { readonly startSec: number; readonly endSec: number }

/** RMS の刻み（10ms）。 */
export const DUB_FRAME_SEC = 0.01
/** 最大からこれより小さい所は声とみなさない。 */
export const DUB_VOICED_BELOW_MAX_DB = 30
/** これより短い途切れはつなぐ（息継ぎ）。 */
export const DUB_BRIDGE_GAP_SEC = 0.12
/** これより短い区間は捨てる（物音）。 */
export const DUB_MIN_CHUNK_SEC = 0.06
/** 読み上げの頭と尻の無音を落とすときの高さ（dBFS）。 */
export const DUB_TRIM_THRESHOLD_DB = -45
/** 無音を落とした後に頭と尻に残す長さ。 */
export const DUB_TRIM_PAD_SEC = 0.15
/** 音量を合わせるとき、最大からこれより小さい区切りは数えない。 */
export const DUB_LEVEL_BELOW_MAX_DB = 25

const EPS = 1e-9

/** 秒を ms で丸める（10ms 刻みの掛け算の誤差を残さない）。 */
export const roundMs = (sec: number): number => Math.round(sec * 1000) / 1000

const maxFinite = (values: readonly number[]): number | null => {
  const finite = values.filter((v) => Number.isFinite(v))
  return finite.length === 0 ? null : Math.max(...finite)
}

type Run = { readonly first: number; readonly last: number }

/** しきい値より大きい区切りの並び（連続する所ごと）。 */
const runsAbove = (values: readonly number[], threshold: number): readonly Run[] =>
  values.reduce<readonly Run[]>((runs, value, index) => {
    if (!(value > threshold)) return runs
    const previous = runs[runs.length - 1]
    if (previous !== undefined && previous.last === index - 1) return [...runs.slice(0, -1), { first: previous.first, last: index }]
    return [...runs, { first: index, last: index }]
  }, [])

export type SpeechChunkOptions = {
  readonly frameSec?: number
  readonly belowMaxDb?: number
  readonly bridgeGapSec?: number
  readonly minChunkSec?: number
}

export const speechChunks = (rmsDb: readonly number[], options: SpeechChunkOptions = {}): readonly DubChunk[] => {
  const frameSec = options.frameSec ?? DUB_FRAME_SEC
  const bridge = options.bridgeGapSec ?? DUB_BRIDGE_GAP_SEC
  const minChunk = options.minChunkSec ?? DUB_MIN_CHUNK_SEC
  const max = maxFinite(rmsDb)
  if (max === null) return []
  const runs = runsAbove(rmsDb, max - (options.belowMaxDb ?? DUB_VOICED_BELOW_MAX_DB))
  const bridged = runs.reduce<readonly Run[]>((acc, run) => {
    const previous = acc[acc.length - 1]
    const gapSec = previous === undefined ? Number.POSITIVE_INFINITY : (run.first - previous.last - 1) * frameSec
    if (previous !== undefined && gapSec < bridge - EPS) return [...acc.slice(0, -1), { first: previous.first, last: run.last }]
    return [...acc, run]
  }, [])
  return bridged
    .filter((run) => (run.last - run.first + 1) * frameSec >= minChunk - EPS)
    .map((run) => ({ startSec: roundMs(run.first * frameSec), endSec: roundMs((run.last + 1) * frameSec) }))
}

/** 読み上げの頭と尻の無音を落とす範囲（0.15 秒ずつ残す）。全部が小さければ null。 */
export const trimBounds = (
  rmsDb: readonly number[],
  durationSec: number,
  options: { readonly frameSec?: number; readonly thresholdDb?: number; readonly padSec?: number } = {},
): DubChunk | null => {
  const frameSec = options.frameSec ?? DUB_FRAME_SEC
  const pad = options.padSec ?? DUB_TRIM_PAD_SEC
  const runs = runsAbove(rmsDb, options.thresholdDb ?? DUB_TRIM_THRESHOLD_DB)
  const first = runs[0]
  const last = runs[runs.length - 1]
  if (first === undefined || last === undefined) return null
  return {
    startSec: roundMs(Math.max(0, first.first * frameSec - pad)),
    endSec: roundMs(Math.min(durationSec, (last.last + 1) * frameSec + pad)),
  }
}

/** 声のある所の大きさ（dB）。区切りの dB を力（power）で平均する。音が無ければ null。 */
export const voicedLevelDb = (frameDb: readonly number[], belowMaxDb = DUB_LEVEL_BELOW_MAX_DB): number | null => {
  const max = maxFinite(frameDb)
  if (max === null) return null
  const voiced = frameDb.filter((db) => db > max - belowMaxDb)
  const power = voiced.reduce((sum, db) => sum + 10 ** (db / 10), 0) / voiced.length
  return 10 * Math.log10(power)
}
