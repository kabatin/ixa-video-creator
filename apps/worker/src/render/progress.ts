/**
 * レンダリング進捗の間引き。
 *
 * `TimelineRenderer.render` の `onProgress` は **フレームごとに呼ばれる**。
 * 1 分の 30fps で 1800 回。そのたびに UPDATE を投げると、進捗表示のために
 * レンダリングそのものを遅くすることになる。
 *
 * そこで「前回の報告から 1% 進んだ」か「前回の報告から 2 秒経った」ときだけ通す。
 * どちらの条件でも、人間が進捗バーを見て遅いと感じない程度には更新される。
 */

/** これだけ進んだら報告する。 */
export const PROGRESS_STEP = 0.01

/** 進みが遅くても、これだけ経ったら報告する（ミリ秒）。 */
export const PROGRESS_INTERVAL_MS = 2_000

export type ProgressReporterOptions = {
  /** 報告すると決まったときに呼ばれる。ここで DB を更新する。 */
  readonly onReport: (progress: number) => void
  /** テストから時間を差し替えるための時計。既定は `Date.now`。 */
  readonly now?: () => number
  readonly step?: number
  readonly intervalMs?: number
}

/**
 * 間引き付きの進捗ハンドラを作る。**入力は変更せず、状態はクロージャに閉じる。**
 *
 * 起点は 0。ジョブは 0 から始まると決まっているので、最初の 1 回目だからという理由では通さない
 * （そうしないと 1 フレーム目の 0.0001 が必ず DB に飛ぶ）。
 *
 * - 前回より進んでいない値（据え置き・巻き戻り）は無視する
 * - 完了（1）は刻みに満たなくても必ず通す。進捗バーが 99% で止まると壊れて見えるため
 */
export const createProgressReporter = (options: ProgressReporterOptions) => {
  const clock = options.now ?? (() => Date.now())
  const step = options.step ?? PROGRESS_STEP
  const intervalMs = options.intervalMs ?? PROGRESS_INTERVAL_MS

  let lastReported = 0
  let lastReportedAt = clock()

  return (progress: number): void => {
    const clamped = Math.min(1, Math.max(0, progress))
    if (clamped <= lastReported) return

    const advancedEnough = clamped - lastReported >= step
    const waitedEnough = clock() - lastReportedAt >= intervalMs
    const isComplete = clamped === 1

    if (!advancedEnough && !waitedEnough && !isComplete) return

    lastReported = clamped
    lastReportedAt = clock()
    options.onReport(clamped)
  }
}
