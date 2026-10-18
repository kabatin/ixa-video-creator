/**
 * 音 1 本だけを鳴らす（インスペクターの再生／停止・素材ビューアの試聴。ADR-0052）。**React を含まない。**
 * 楽曲は頭から終わりまで、効果音のクリップは `inSec` から `durationSec` だけを鳴らす（レンダラと同じ範囲）。
 */

export type SoloRange = { readonly inSec: number; readonly outSec: number }

/** 終わりに着いたとみなす手前の幅（秒）。止める予約が間に合わなかったときの受け皿。 */
export const SOLO_END_EPSILON_SEC = 0.005

/**
 * 止める予約を早める幅（ミリ秒）。位置を読んでから予約するまでと、予約が遅れて発火するぶん。
 * **はみ出すより、数ミリ秒早く止める方を選ぶ**（効果音の後ろに次の音が続くことがある）。
 */
export const SOLO_STOP_MARGIN_MS = 5

/**
 * 効果音のクリップが鳴らす範囲。**`durationSec` が正**（レンダラは `inSec` から `durationSec` だけ鳴らし、
 * `outSec` は見ない。帯で端をつまむと書かれるのは `startSec` / `durationSec` だけ）。
 */
export const clipSoloRange = (clip: { readonly inSec: number; readonly durationSec: number }): SoloRange => ({
  inSec: clip.inSec,
  outSec: clip.inSec + clip.durationSec,
})

/**
 * 実際に鳴らす範囲。尺がまだ分からなければ null（押せない）。
 * 範囲を渡さなければ全体。範囲は音の尺に収め、終わりが始まりより前なら鳴らす範囲は無い（null）。
 */
export const resolveSoloRange = (range: SoloRange | undefined, durationSec: number): SoloRange | null => {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null
  const inSec = Math.min(Math.max(range?.inSec ?? 0, 0), durationSec)
  const outSec = Math.min(range?.outSec ?? durationSec, durationSec)
  return outSec > inSec ? { inSec, outSec } : null
}

/** 範囲の終わりまで鳴らしたか。 */
export const reachedSoloEnd = (currentSec: number, range: SoloRange): boolean =>
  currentSec >= range.outSec - SOLO_END_EPSILON_SEC

/**
 * いまの位置から、止める予約までのミリ秒。**まだ範囲の頭から進んでいなければ null**（予約しない）。
 * 読み込みを待っている間に予約すると、鳴る前に止めてしまう。
 */
export const soloStopDelayMs = (currentSec: number, range: SoloRange): number | null =>
  currentSec <= range.inSec ? null : Math.max(0, (range.outSec - currentSec) * 1000 - SOLO_STOP_MARGIN_MS)
