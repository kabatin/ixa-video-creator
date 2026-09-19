import { viewDurationSec, type ViewRange } from '@/lib/waveform-draw'

/**
 * 3 帯域の波形（PHASE 8.1 / UI-WORKBENCH-2 §3）。**canvas も React も含まない。**
 *
 * 振幅の最大だけで描くと、音圧を揃えた曲は平らな四角になる（本制作の曲で 2000 点の
 * 90% が 0.71〜0.77）。曲の構造は帯域の中身に出る: ブレイクでは低域が消え、ドロップで戻る。
 * だから低・中・高を重ねて描き、各帯域は**曲ごとに引き伸ばして**から高さにする。
 */

/** 各配列は同じ長さ（音声サービスは 2000 点）、0..1。 */
export type WaveformBands = {
  readonly rms: readonly number[]
  readonly low: readonly number[]
  readonly mid: readonly number[]
  readonly high: readonly number[]
}

/** 引き伸ばしの端。下位 2% を 0、上位 98% を 1 に置く（外れ値 1 点で全体が潰れないように）。 */
export const STRETCH_LOW_QUANTILE = 0.02
export const STRETCH_HIGH_QUANTILE = 0.98

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0

const quantile = (sorted: readonly number[], q: number): number => {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
  return sorted[index] ?? 0
}

/**
 * 曲ごとの引き伸ばし。**幅が無い（全部同じ値）なら 0.5 に揃える**（割り算で壊さない）。
 * 新しい配列を返し、入力は変えない。
 */
export const stretchSeries = (
  values: readonly number[],
  lowQ = STRETCH_LOW_QUANTILE,
  highQ = STRETCH_HIGH_QUANTILE,
): readonly number[] => {
  if (values.length === 0) return []
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  const lo = quantile(sorted, lowQ)
  const hi = quantile(sorted, highQ)
  if (!(hi > lo)) return values.map(() => 0.5)
  return values.map((v) => clamp01((v - lo) / (hi - lo)))
}

/**
 * 引き伸ばしのあとに掛ける曲線（値の `BAND_GAMMA` 乗）。**普段の音を低く、山だけを高く**する。
 * 引き伸ばしだけだと高域が常に天井に張り付き、他の層を覆った（実機 2026-09-19）。
 */
export const BAND_GAMMA = 2

const emphasize = (values: readonly number[]): readonly number[] =>
  values.map((v) => v ** BAND_GAMMA)

/** 描く前に全系列を引き伸ばす。曲を開いたときに 1 回だけ呼ぶ（列ごとに呼ばない）。 */
export const stretchBands = (bands: WaveformBands): WaveformBands => ({
  rms: stretchSeries(bands.rms),
  low: emphasize(stretchSeries(bands.low)),
  mid: emphasize(stretchSeries(bands.mid)),
  high: emphasize(stretchSeries(bands.high)),
})

/**
 * 列ごとの値（0..1）。列は画面の 1 デバイスピクセル。
 * 1 列に複数の点が入るときは**平均**（帯域は面で見せたい。最大だと引いたときに埋まる）。
 */
export const seriesColumns = (
  series: readonly number[],
  view: ViewRange,
  durationSec: number,
  columnCount: number,
): readonly number[] => {
  const span = viewDurationSec(view)
  if (series.length === 0 || !(columnCount > 0) || !(durationSec > 0) || !(span > 0)) return []
  const perSec = series.length / durationSec
  const last = series.length - 1
  return Array.from({ length: Math.trunc(columnCount) }, (_, column) => {
    const fromSec = view.startSec + (span * column) / columnCount
    const toSec = view.startSec + (span * (column + 1)) / columnCount
    const start = Math.min(last, Math.max(0, Math.floor(fromSec * perSec)))
    const end = Math.max(start + 1, Math.min(series.length, Math.ceil(toSec * perSec)))
    let sum = 0
    for (let i = start; i < end; i += 1) sum += series[i] ?? 0
    return clamp01(sum / (end - start))
  })
}

/** 奥から手前へ描く順。低域がいちばん奥で太く、高域が手前で細い。 */
export const BAND_ORDER = ['low', 'mid', 'high'] as const
export type BandName = (typeof BAND_ORDER)[number]

/**
 * 帯域ごとの高さの上限（全高に対する割合）。**重ねて描いたときに手前が奥を隠し切らない**よう、
 * 手前ほど低くする。ブレイクで低域が消えると、奥の太い層が細くなって見える。
 */
export const BAND_HEIGHT_RATIO: Readonly<Record<BandName, number>> = Object.freeze({
  low: 1,
  mid: 0.65,
  high: 0.35,
})

/** 波の区画の外に取る、目印の帯の高さ（CSS px）。小節頭・セクション・ドロップはここに刻む。 */
export const RULER_HEIGHT_PX = 12

/** 波形の既定の高さ（CSS px）。以前の 160px の半分（制作者の指示 2026-09-19）。 */
export const WAVEFORM_HEIGHT_PX = 80

/**
 * セクションの背景の帯。境目で区切った区間を交互に塗る。**線ではなく面で見せる。**
 * 返すのは `[開始秒, 終了秒, 交互の番号]` の並び。
 */
export const sectionStripes = (
  boundarySec: readonly number[],
  durationSec: number,
): readonly (readonly [number, number, 0 | 1])[] => {
  const edges = [0, ...boundarySec.filter((sec) => sec > 0 && sec < durationSec), durationSec]
  return edges
    .slice(0, -1)
    .map((start, index) => [start, edges[index + 1] ?? durationSec, (index % 2) as 0 | 1] as const)
}
