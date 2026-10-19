/**
 * 同じ Layer の中で時間が重なるクリップを、別の行にずらす（制作者 2026-10-19）。**React を含まない。**
 *
 * 重なったまま 1 行に描くと文字が読めず、掴む判定も横の位置だけなので、動かしたり尺を変えたりすると
 * 別のクリップが動いた。行は画面の見た目だけのもので、クリップの Layer（重なり順）は変えない。
 */

export type OverlapRowClip = {
  readonly id: string
  readonly startSec: number
  readonly durationSec: number
}

export type OverlapRows = {
  /** クリップごとの行（0 始まり）。 */
  readonly rows: ReadonlyMap<string, number>
  /** 行の数。空でも 1（置く場所を残す）。 */
  readonly rowCount: number
}

/** 浮動小数の誤差で、接しているだけのクリップを重なりとみなさない。 */
const TOUCH_EPSILON_SEC = 1e-6

/**
 * 始まりの早い順（同じなら ID 順）に、空いている一番上の行へ入れる。並び順に左右されない。
 * **動かしている途中の位置では決めない**（呼び出し側は確定した位置を渡す）。途中で行が入れ替わると掴んだものが逃げる。
 */
export const assignOverlapRows = (clips: readonly OverlapRowClip[]): OverlapRows => {
  const ordered = [...clips].sort((a, b) => a.startSec - b.startSec || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const placed = ordered.reduce<{ readonly rowEnds: readonly number[]; readonly rows: ReadonlyMap<string, number> }>(
    (acc, clip) => {
      const free = acc.rowEnds.findIndex((end) => end <= clip.startSec + TOUCH_EPSILON_SEC)
      const row = free < 0 ? acc.rowEnds.length : free
      const end = clip.startSec + clip.durationSec
      const rowEnds = row === acc.rowEnds.length ? [...acc.rowEnds, end] : acc.rowEnds.map((e, i) => (i === row ? end : e))
      return { rowEnds, rows: new Map([...acc.rows, [clip.id, row]]) }
    },
    { rowEnds: [], rows: new Map() },
  )
  return { rows: placed.rows, rowCount: Math.max(1, placed.rowEnds.length) }
}

export type OverlapRowLayout = {
  /** 1 行目の上端（帯の上から。上には Layer の札がある）。 */
  readonly topPx: number
  /** 行の間隔。 */
  readonly rowPitchPx: number
  readonly rowCount: number
}

/** 帯の上からの位置（px）が何行目か。札の上は 1 行目、下にはみ出したら最後の行。 */
export const overlapRowAtOffset = (offsetPx: number, layout: OverlapRowLayout): number => {
  const row = Math.floor((offsetPx - layout.topPx) / layout.rowPitchPx)
  return Math.min(Math.max(row, 0), layout.rowCount - 1)
}
