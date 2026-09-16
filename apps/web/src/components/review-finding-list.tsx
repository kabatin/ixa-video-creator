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
    <li className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${findingSeverityClassName(finding.severity)}`}
        >
          {findingSeverityLabel(finding.severity)}
        </span>
        <span className="text-xs font-medium text-slate-700">
          {reviewerLabel(finding.reviewer)}
        </span>
        {moment !== null && (
          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
            {moment}
          </span>
        )}
        {finding.score !== null && (
          <span className="text-xs text-slate-500">スコア {finding.score.toFixed(2)}</span>
        )}
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">
        {finding.message}
      </p>

      {finding.suggestedPromptDelta !== null && (
        <div className="mt-3 rounded bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-600">再生成時のプロンプト追加</p>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-slate-800">
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
      <p className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
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
