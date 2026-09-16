/**
 * ffprobe の `r_frame_rate` / `avg_frame_rate` は "分子/分母" の分数文字列で返る。
 * 例: "30000/1001" は 29.97 fps、"30/1" は 30 fps。
 * ストリームが存在しない・不定の場合は "0/0" が返るため、必ず null へ落とす。
 */
export const parseFrameRate = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) return null

  const trimmed = value.trim()
  if (trimmed === '') return null

  const match = /^(-?\d+)\/(-?\d+)$/.exec(trimmed)
  if (match === null) {
    // 分数ではなく "30" のような単純な数値で返る実装も許容する。
    const plain = Number(trimmed)
    return Number.isFinite(plain) && plain > 0 ? plain : null
  }

  const numerator = Number(match[1])
  const denominator = Number(match[2])
  if (denominator === 0) return null

  const fps = numerator / denominator
  return Number.isFinite(fps) && fps > 0 ? fps : null
}
