/**
 * 灰色の rawvideo（1 画素 1 バイト）から動きの強さの列を作る（ADR-0054 §2）。**純粋。**
 * i 番目は i 番目のコマと 1 つ前のコマの差の平均（0〜1）。先頭は比べる相手が無いので 0。
 */
export const frameEnergy = (bytes: Uint8Array, width: number, height: number): readonly number[] => {
  const size = width * height
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`コマの大きさが正ではありません: ${String(width)}×${String(height)}`)
  }
  const count = Math.floor(bytes.length / size)
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return 0
    const offset = i * size
    let sum = 0
    for (let p = 0; p < size; p += 1) {
      sum += Math.abs((bytes[offset + p] ?? 0) - (bytes[offset - size + p] ?? 0))
    }
    return sum / (size * 255)
  })
}

/** 帯に並べるコマの時刻。Take を等間隔に分け、各区間の真ん中を取る（頭と尻の黒いコマを避ける）。 */
export const stripFrameTimes = (durationSec: number, count: number): readonly number[] =>
  durationSec > 0 ? Array.from({ length: count }, (_, i) => ((i + 0.5) * durationSec) / count) : []
