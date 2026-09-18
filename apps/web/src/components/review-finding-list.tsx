import type { ReviewFinding } from '@ixa/domain'
import {
  findingSeverityClassName,
  findingSeverityLabel,
  formatEvidenceMoment,
  reviewerLabel,
  sortFindings,
} from '@/lib/review-display'

/**
 * 自動レビューの指摘一覧。
 * severity が一目で分かること・何秒地点の指摘かが分かること・
 * 再生成で何が変わるか（suggestedPromptDelta）が分かることを満たす。
 */

export type ReviewFindingListProps = {
  readonly findings: readonly ReviewFinding[]
}

const FindingRow = ({ finding }: { readonly finding: ReviewFinding }) => {
  const moment = formatEvidenceMoment(finding.evidence)

  return (
    <li className="rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${findingSeverityClassName(finding.severity)}`}
        >
          {findingSeverityLabel(finding.severity)}
        </span>
        <span className="text-xs font-medium text-text">
          {reviewerLabel(finding.reviewer)}
        </span>
        {moment !== null && (
          <span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs text-text">
            {moment}
          </span>
        )}
        {finding.score !== null && (
          <span className="text-xs text-muted">スコア {finding.score.toFixed(2)}</span>
        )}
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text">
        {finding.message}
      </p>

      {finding.suggestedPromptDelta !== null && (
        <div className="mt-3 rounded bg-surface-2 p-3">
          <p className="text-xs font-semibold text-muted">再生成時のプロンプト追加</p>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-text">
            {finding.suggestedPromptDelta}
          </p>
        </div>
      )}
    </li>
  )
}

export const ReviewFindingList = ({ findings }: ReviewFindingListProps) => {
  if (findings.length === 0) {
    return (
      <p className="rounded-md border border-line bg-surface-2 p-4 text-sm text-muted">
        指摘はありません。
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {sortFindings(findings).map((finding) => (
        <FindingRow key={finding.id} finding={finding} />
      ))}
    </ul>
  )
}
