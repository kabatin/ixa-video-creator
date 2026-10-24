/**
 * 素材ビューアの波形に重ねる再生位置（2026-10-24、制作者「どこを再生してるか分からない」）。**React を含まない。**
 * 波形は曲全体を描いているので、位置は尺に対する割合で決まる。
 */

/** 再生位置の線の左端（%）。尺が分からなければ null（線を引かない）。 */
export const playheadPct = (currentSec: number, durationSec: number): number | null => {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || !Number.isFinite(currentSec)) return null
  return (Math.min(Math.max(currentSec, 0), durationSec) / durationSec) * 100
}

/** 押した場所の秒。`ratio` は波形の左端から押した所までの幅の割合（0〜1 の外は端へ寄せる）。 */
export const secAtRatio = (ratio: number, durationSec: number): number =>
  Math.min(Math.max(ratio, 0), 1) * durationSec
