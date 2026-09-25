import type { ProjectId } from '@ixa/domain'
import Link from 'next/link'
import {
  MAX_ROWS_PER_GROUP,
  describeIssueShot,
  groupTimelineIssues,
  rowsForGroup,
  type TimelineIssueGroup,
} from '@/lib/issue-grouping'
import {
  issueSeverityClassName,
  issueSeverityLabel,
  summarizeTimelineIssues,
} from '@/lib/timeline-display'
import type { TimelineIssueView } from '@/lib/timeline-issues'

/**
 * タイムラインの検証結果（隙間・重なり）。**レンダリング前にここで気付けるようにする。**
 *
 * `issues` が `null` のときは「検査できていない」であって「問題なし」ではない。
 * 空配列と同じ見た目にすると、人は検査済みだと信じてしまう（lessons L-015）。
 *
 * 実データでは指摘が 121 件出る。以前は全件を平らに並べていたため、
 * このパネルだけで 3470px を占め、編集 UI が 3766px の位置まで押し下げられていた。
 * さらに一覧が `role="alert"` の中にあったので、**読み上げでは 121 件が一度に流れた。**
 *
 * いまは 2 つに分けている。
 * - 件数の要約だけを `role="alert"` にする。ここは 1 文で読み終わる
 * - 明細は alert の外に置き、種類ごとに畳む。開いた束だけが読み上げられる
 */

export type TimelineIssuePanelProps = {
  readonly issues: readonly TimelineIssueView[] | null
  /**
   * 指摘から Shot 詳細へ飛ぶために要る。
   * 渡されないうちはリンクにせず、Shot の見分けだけを文字で出す
   * （呼び出し元がまだ渡していない間に、押せないリンクを作らないため）。
   */
  readonly projectId?: ProjectId
}

const PANEL_LABEL = 'タイムラインの検証結果'

const IssueRow = ({
  issue,
  projectId,
}: {
  readonly issue: TimelineIssueView
  readonly projectId: ProjectId | undefined
}) => {
  // 見分けは常に出す。`projectId` が無いときに消えるのはリンクだけ。
  const shot = describeIssueShot(issue, projectId)

  return (
    <li className="flex flex-wrap items-start gap-2 border-t border-line py-2 text-sm text-text first:border-t-0">
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${issueSeverityClassName(issue.severity)}`}
      >
        {issueSeverityLabel(issue.severity)}
      </span>
      <span className="min-w-0 flex-1 break-words">{issue.message}</span>
      {shot !== null &&
        (shot.href === null ? (
          <span className="text-xs text-muted">{shot.label}</span>
        ) : (
          <Link
            href={shot.href}
            className="text-xs font-medium text-text underline hover:text-accent"
          >
            {`${shot.label} を開く`}
          </Link>
        ))}
    </li>
  )
}

/**
 * 種類ごとの束。**既定は畳んだまま。**
 * 開く操作は `<details>` に任せる。JavaScript が動く前でも開ける。
 */
const IssueGroupBlock = ({
  group,
  projectId,
}: {
  readonly group: TimelineIssueGroup
  readonly projectId: ProjectId | undefined
}) => {
  const { rows, hiddenCount } = rowsForGroup(group)

  return (
    <details className="rounded-md border border-danger/40 bg-surface">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-3 text-sm">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${issueSeverityClassName(group.severity)}`}
        >
          {issueSeverityLabel(group.severity)}
        </span>
        <span className="font-medium text-text">{group.label}</span>
        <span className="text-text">{`${String(group.count)} 件`}</span>
        {group.shotCount > 0 && (
          <span className="text-xs text-muted">{`Shot ${String(group.shotCount)} 件が関係`}</span>
        )}
        {/* 種類の内部コード（shot_gap_head など）は出さない。見出しが言っている。 */}
      </summary>

      <ul className="px-3 pb-2">
        {rows.map((issue, index) => (
          <IssueRow
            key={`${issue.code}-${issue.shotId ?? 'none'}-${String(index)}`}
            issue={issue}
            projectId={projectId}
          />
        ))}
      </ul>

      {hiddenCount > 0 && (
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          {`同じ種類があと ${String(hiddenCount)} 件あります（一度に出すのは ${String(MAX_ROWS_PER_GROUP)} 件まで）。上から片付けて、もう一度検査してください。`}
        </p>
      )}
    </details>
  )
}

export const TimelineIssuePanel = ({ issues, projectId }: TimelineIssuePanelProps) => {
  const summary = summarizeTimelineIssues(issues)

  if (summary.state === 'unchecked') {
    return (
      <section
        role="alert"
        className="rounded-lg border border-warn/40 bg-warn/10 p-4"
        aria-label={PANEL_LABEL}
      >
        <h2 className="text-sm font-semibold text-warn">{summary.message}</h2>
        <p className="mt-1 text-sm text-warn">
          Shot・Transition・クリップのいずれかを読み込めていません。
          この状態は「指摘なし」ではありません。読み込みに失敗した理由を先に解消してください。
        </p>
      </section>
    )
  }

  if (summary.state === 'clean') {
    return (
      <section
        role="status"
        className="rounded-lg border border-ok/40 bg-ok/10 p-4"
        aria-label={PANEL_LABEL}
      >
        <h2 className="text-sm font-semibold text-ok">{summary.message}</h2>
        <p className="mt-1 text-sm text-ok">
          レンダリング時にはサーバ側でも同じ検査を通します。
        </p>
      </section>
    )
  }

  const groups = groupTimelineIssues(issues ?? [])

  return (
    <section className="rounded-lg border border-danger/40 bg-danger/10 p-4" aria-label={PANEL_LABEL}>
      {/* 読み上げるのはここだけ。明細を alert に入れると全件が一度に流れる。 */}
      <div role="alert">
        <h2 className="text-sm font-semibold text-danger">
          {`タイムラインに指摘があります（${summary.message}・${String(groups.length)} 種類）`}
        </h2>
        {summary.errorCount > 0 && (
          <p className="mt-1 text-sm text-danger">
            「レンダリング不可」が残っている間は書き出しが 422 で拒否されます。
          </p>
        )}
      </div>

      <p className="mt-1 text-sm text-danger">
        種類ごとに畳んであります。見出しを開くと、その種類の指摘と対象の Shot が出ます。
      </p>

      <ul className="mt-3 space-y-2">
        {groups.map((group) => (
          <li key={group.code}>
            <IssueGroupBlock group={group} projectId={projectId} />
          </li>
        ))}
      </ul>
    </section>
  )
}
