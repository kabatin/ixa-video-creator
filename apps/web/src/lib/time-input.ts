/**
 * 時刻・尺の入力（UI-WORKBENCH-2 §5.1 / P7）。**React を含まない。**
 * 画面は `0:02.67` / `1.97s` で出すので、入力も同じ形で受ける（素の小数も受ける）。
 * 読めなければ null（保存しない）。
 */

/** `0:02.67` / `2.67` / `1:02` → 秒。負や数でないものは null。 */
export const parseClockInput = (raw: string): number | null => {
  const text = raw.trim()
  const clock = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(text)
  if (clock !== null) {
    const minutes = Number(clock[1])
    const seconds = Number(clock[2])
    if (seconds >= 60) return null
    return minutes * 60 + seconds
  }
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null
  return Number(text)
}

/** `1.97s` / `1.97` → 秒。0 以下は尺にならないので null。 */
export const parseDurationInput = (raw: string): number | null => {
  const text = raw.trim().replace(/s$/i, '').trim()
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null
  const value = Number(text)
  return value > 0 ? value : null
}

/**
 * フェードの長さ（秒）。空・0 はフェードなし（0）。`2.5` と `2.5s` のどちらでも読む。読めない値・負の値は null。
 * 尺（`parseDurationInput`）と違い 0 を受ける。
 */
export const parseFadeInput = (raw: string): number | null => {
  const text = raw.trim().replace(/s$/i, '').trim()
  if (text === '') return 0
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null
  return Number(text)
}
