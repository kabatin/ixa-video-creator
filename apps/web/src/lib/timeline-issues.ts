
/**
 * タイムラインの指摘を画面に出すための型。
 */

export type TimelineIssueSeverity = 'error' | 'warning'

/**
 * 表示用の指摘。`@ixa/timeline` の `TimelineIssue`（および API が返す DTO）と同じ形。
 * 構造で合わせてあるので、出どころを API へ差し替えても画面は変わらない。
 */
export type TimelineIssueView = {
  readonly severity: TimelineIssueSeverity
  readonly code: string
  readonly message: string
  /** サーバが返す ULID 文字列。表示にしか使わないので branded 型にしない。 */
  readonly shotId?: string
}

/**
 * 判定規則は**ここに置かない。** サーバの `validateTimeline` が唯一の正で、
 * 画面は `GET /projects/{id}/timeline/issues` の結果をそのまま表示する。
 *
 * 以前はここに同じ規則を書き写していたが、規則が 2 箇所にあると必ずズレて、
 * レンダリングでは止まるのに画面では合格に見える状態が生まれる。
 * このファイルに残すのは、表示のための型と重要度の順序だけ。
 */
