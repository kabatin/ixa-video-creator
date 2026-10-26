import { DUB_FRAME_SEC, type DubChunk } from './speech-chunks.js'

/**
 * 口との一致率（ADR-0062）。元の声と置いた声の「話す／黙る」を 10ms ごとに比べた割合。
 * 口の形までは見ない（話しているかどうかだけ）。
 */

/** `startSec`〜`endSec` を 10ms に区切り、区切りの真ん中が区間に入っていれば true。 */
export const voicedMask = (
  chunks: readonly DubChunk[],
  startSec: number,
  endSec: number,
  frameSec = DUB_FRAME_SEC,
): readonly boolean[] =>
  Array.from({ length: Math.max(0, Math.round((endSec - startSec) / frameSec)) }, (_, k) => {
    const t = startSec + (k + 0.5) * frameSec
    return chunks.some((chunk) => t >= chunk.startSec && t < chunk.endSec)
  })

/** 同じ区切りの割合（0〜1）。長さが違えば、足りない方は黙っているとみなす。比べる区切りが無ければ null。 */
export const agreement = (a: readonly boolean[], b: readonly boolean[]): number | null => {
  const length = Math.max(a.length, b.length)
  if (length === 0) return null
  const same = Array.from({ length }, (_, i) => (a[i] ?? false) === (b[i] ?? false)).filter(Boolean).length
  return same / length
}
