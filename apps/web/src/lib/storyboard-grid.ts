/**
 * ストーリーボードの列数（UI-WORKBENCH §5.3）。**React を含まない。**
 *
 * **画面幅ではなく、割り当てられた区画の幅で決める**（lessons L-025）。
 * ドックは利用者が狭めも広げもするので、同じ画面幅でも区画は 300px にも 1200px にもなる。
 * 4 列にはしない（D6: 中央は絵を大きく見る場所。探すのは右の一覧）。
 */
export const MAX_STORYBOARD_COLUMNS = 3

const BREAKPOINTS: readonly (readonly [minWidthPx: number, columns: number])[] = [
  [720, 3],
  [480, 2],
]

export const storyboardColumns = (regionWidthPx: number): number =>
  BREAKPOINTS.find(([min]) => regionWidthPx >= min)?.[1] ?? 1
