import { ShotId, type ProjectId } from '@ixa/domain'
import { TIMELINE_ISSUE_CODES } from '@ixa/timeline'
import { shotDetailHref } from '@/lib/shot-links'
import type { TimelineIssueSeverity, TimelineIssueView } from '@/lib/timeline-issues'

/**
 * タイムラインの指摘を読める形にまとめる。**React を含まない純粋関数だけを置く。**
 *
 * 実データで指摘は 121 件出る。全件を平らに並べると赤いパネルだけで 3470px になり、
 * 編集 UI が画面の外へ押し出される。さらに読み上げでは 121 件が一度に流れる。
 *
 * まとめ方は「種類ごと」にする。**同じ種類の指摘は同じ直し方をする**ためで、
 * 利用者は「重なりを 72 件選別する」という 1 つの作業として扱える。
 * Shot ごとにまとめると 1 件ずつの束が 70 個できるだけで、件数は減っても作業は減らない。
 *
 * ここでは**判定をしない。** 何が指摘かを決めるのはサーバの `validateTimeline` で、
 * ここが触るのは並び順・件数・見出しといった「ズレても壊れないもの」だけ（lessons L-016）。
 */

/**
 * 種類の見出し。コードをそのまま出しても、何を直せばよいかが分からない。
 * キーはサーバの定数を参照して書き写しを避ける。知らないコードは生のまま出す。
 */
const ISSUE_CODE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  [TIMELINE_ISSUE_CODES.shotOverlap]: 'Shot どうしが時間で重なっている',
  [TIMELINE_ISSUE_CODES.shotGap]: 'Shot と Shot の間に隙間がある',
  [TIMELINE_ISSUE_CODES.shotNonPositiveDuration]: '尺が 0 以下の Shot がある',
  [TIMELINE_ISSUE_CODES.shotMissingTake]: 'Take が選ばれていない Shot がある',
  [TIMELINE_ISSUE_CODES.transitionNotAdjacent]: '隣り合っていない Shot に Transition がある',
  [TIMELINE_ISSUE_CODES.transitionTooLong]: 'Transition が隣の Shot より長い',
  [TIMELINE_ISSUE_CODES.transitionDegraded]: 'Transition が縮退している',
  [TIMELINE_ISSUE_CODES.clipOutOfRange]: 'クリップが尺の外にある',
})

export const issueCodeLabel = (code: string): string => ISSUE_CODE_LABELS[code] ?? code

/** 種類ごとにまとめた指摘。`issues` は入力の順を保つ。 */
export type TimelineIssueGroup = {
  readonly code: string
  /** 画面に出す見出し。コードを知らない人にも直し方が分かる言葉にする。 */
  readonly label: string
  /** 束の中で最も重い severity。1 件でも error があれば error。 */
  readonly severity: TimelineIssueSeverity
  readonly count: number
  /** この種類が巻き込んでいる Shot の数。選別の規模が先に読めるようにする。 */
  readonly shotCount: number
  readonly issues: readonly TimelineIssueView[]
}

const SEVERITY_RANK: Readonly<Record<TimelineIssueSeverity, number>> = Object.freeze({
  error: 0,
  warning: 1,
})

const heavier = (a: TimelineIssueSeverity, b: TimelineIssueSeverity): TimelineIssueSeverity =>
  SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b

const distinctShotCount = (issues: readonly TimelineIssueView[]): number =>
  new Set(issues.flatMap((issue) => (issue.shotId === undefined ? [] : [issue.shotId]))).size

/**
 * 種類ごとにまとめる。**入力は変更しない。**
 *
 * 並びは「重い順 → 件数の多い順 → 最初に現れた順」。
 * 重いものを先に出すのはレンダリングを止めている指摘から読ませるため、
 * 件数の多い順にするのは、まとめて片付けられる山を先に見せるため。
 *
 * 空配列は空配列を返す。**「指摘なし」と「検査できていない」の区別はここでしない。**
 * それは `summarizeTimelineIssues` の責務で、null をここへ持ち込まない（lessons L-015）。
 */
export const groupTimelineIssues = (
  issues: readonly TimelineIssueView[],
): readonly TimelineIssueGroup[] =>
  [...new Set(issues.map((issue) => issue.code))]
    .map((code, index) => {
      const members = issues.filter((issue) => issue.code === code)
      return {
        index,
        group: {
          code,
          label: issueCodeLabel(code),
          severity: members.reduce<TimelineIssueSeverity>(
            (worst, issue) => heavier(worst, issue.severity),
            'warning',
          ),
          count: members.length,
          shotCount: distinctShotCount(members),
          issues: members,
        },
      }
    })
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[a.group.severity] - SEVERITY_RANK[b.group.severity]
      if (bySeverity !== 0) return bySeverity
      const byCount = b.group.count - a.group.count
      return byCount === 0 ? a.index - b.index : byCount
    })
    .map((entry) => entry.group)

/**
 * 1 つの束で一度に出す明細の上限。
 *
 * 束は既定で畳んであるので画面の高さは出ないが、開いたときに 72 行が続くと
 * どこから手を付けるか決められない。**上から片付けて検査し直す**運用に合わせて切る。
 * 隠した件数は必ず画面に出す。黙って消すと「直したのに減らない」になる。
 */
export const MAX_ROWS_PER_GROUP = 50

export type GroupRows = {
  readonly rows: readonly TimelineIssueView[]
  /** 表示していない件数。0 なら全件出ている。 */
  readonly hiddenCount: number
}

export const rowsForGroup = (
  group: TimelineIssueGroup,
  limit: number = MAX_ROWS_PER_GROUP,
): GroupRows => {
  const rows = group.issues.slice(0, Math.max(limit, 0))
  return { rows, hiddenCount: group.count - rows.length }
}

/**
 * 指摘から Shot 詳細へのリンク。**飛べないときは null を返す。**
 *
 * `shotId` はサーバが返す素の文字列なので、ULID として読めることを必ず確かめる。
 * 読めない値でリンクを作ると、押した先が「ID が不正です」になり、
 * 利用者は自分の操作を間違えたと思う。
 */
export const issueShotHref = (
  issue: Pick<TimelineIssueView, 'shotId'>,
  projectId: ProjectId | undefined,
): string | null => {
  if (issue.shotId === undefined || projectId === undefined) return null
  const parsed = ShotId.safeParse(issue.shotId)
  return parsed.success ? shotDetailHref({ id: parsed.data, projectId }) : null
}

/** リンクの見出し。ULID を丸ごと出すと読めないので末尾だけを見分けに使う。 */
export const SHOT_ID_TAIL_LENGTH = 6

export const shortShotId = (shotId: string): string =>
  shotId.length <= SHOT_ID_TAIL_LENGTH ? shotId : `…${shotId.slice(-SHOT_ID_TAIL_LENGTH)}`

/**
 * 指摘に添える Shot の見せ方。`shotId` が無ければ null（添えるものが無い）。
 *
 * **`label` は `projectId` に依存しない。** 飛べるかどうかで見分けが消えると、
 * 呼び出し元が `projectId` を渡し忘れた瞬間に「どの Shot の指摘か」が静かに減る。
 * 減ったことは画面を見ても分からないので、誰も気付けない（lessons L-015）。
 * `projectId` が無いときに失われてよいのは**リンクだけ**で、情報は失われない。
 */
export type IssueShotLink = {
  readonly label: string
  /** 飛び先。`projectId` が無い、または `shotId` が ULID として読めないときは null。 */
  readonly href: string | null
}

export const describeIssueShot = (
  issue: Pick<TimelineIssueView, 'shotId'>,
  projectId: ProjectId | undefined,
): IssueShotLink | null =>
  issue.shotId === undefined
    ? null
    : { label: `Shot ${shortShotId(issue.shotId)}`, href: issueShotHref(issue, projectId) }
