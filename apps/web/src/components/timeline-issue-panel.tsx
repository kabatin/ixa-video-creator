import {
  issueSeverityClassName,
  issueSeverityLabel,
  sortTimelineIssues,
  summarizeTimelineIssues,
} from '@/lib/timeline-display'
import type { TimelineIssueView } from '@/lib/timeline-issues'

/**
 * タイムラインの検証結果（隙間・重なり）。**レンダリング前にここで気付けるようにする。**
 *
 * `issues` が `null` のときは「検査できていない」であって「問題なし」ではない。
 * 空配列と同じ見た目にすると、人は検査済みだと信じてしまう（lessons L-015）。
 */

export type TimelineIssuePanelProps = {
  readonly issues: readonly TimelineIssueView[] | null
}

export const TimelineIssuePanel = ({ issues }: TimelineIssuePanelProps) => {
  const summary = summarizeTimelineIssues(issues)

  if (summary.state === 'unchecked') {
    return (
      <section
        role="alert"
        className="rounded-lg border border-amber-300 bg-amber-50 p-4"
        aria-label="タイムラインの検証結果"
      >
        <h2 className="text-sm font-semibold text-amber-900">{summary.message}</h2>
        <p className="mt-1 text-sm text-amber-800">
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
        className="rounded-lg border border-emerald-300 bg-emerald-50 p-4"
        aria-label="タイムラインの検証結果"
      >
        <h2 className="text-sm font-semibold text-emerald-900">{summary.message}</h2>
        <p className="mt-1 text-sm text-emerald-800">
          レンダリング時にはサーバ側でも同じ検査を通します。
        </p>
      </section>
    )
  }

  return (
    <section
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 p-4"
      aria-label="タイムラインの検証結果"
    >
      <h2 className="text-sm font-semibold text-red-900">{`タイムラインに指摘があります（${summary.message}）`}</h2>
      {summary.errorCount > 0 && (
        <p className="mt-1 text-sm text-red-800">
          「レンダリング不可」が残っている間は書き出しが 422 で拒否されます。
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {sortTimelineIssues(issues ?? []).map((issue) => (
          <li
            key={`${issue.code}-${issue.shotId ?? 'none'}-${issue.message}`}
            className="flex flex-wrap items-start gap-2 text-sm text-slate-800"
          >
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${issueSeverityClassName(issue.severity)}`}
            >
              {issueSeverityLabel(issue.severity)}
            </span>
            <span className="min-w-0 flex-1 break-words">{issue.message}</span>
            <code className="text-xs text-slate-500">{issue.code}</code>
          </li>
        ))}
      </ul>
    </section>
  )
}
