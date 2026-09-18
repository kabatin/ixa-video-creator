import type { ReviewFinding, ReviewFindingId } from '@ixa/domain'
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
 *
 * PHASE 6.1 から、差分を持つ指摘は**選んで生成へ戻せる**。
 * 差分を持たない指摘には選択欄を出さない。選んでも足すものが無いため。
 */

/** 選んで生成へ戻すための配線。渡さなければ今までどおり読むだけの一覧。 */
export type FindingSelection = {
  readonly selectedIds: readonly ReviewFindingId[]
  readonly onToggle: (id: ReviewFindingId) => void
  readonly disabled?: boolean
}

export type ReviewFindingListProps = {
  readonly findings: readonly ReviewFinding[]
  readonly selection?: FindingSelection
}

/** 直しとして持ち出せる指摘か。差分が無いものは選ばせない。 */
export const isCorrectable = (finding: ReviewFinding): boolean =>
  finding.suggestedPromptDelta !== null

/** 選ばれた指摘の差分だけを、一覧の並びのまま取り出す。 */
export const selectedDeltas = (
  findings: readonly ReviewFinding[],
  selectedIds: readonly ReviewFindingId[],
): string[] =>
  sortFindings(findings)
    .filter((finding) => selectedIds.includes(finding.id) && finding.suggestedPromptDelta !== null)
    .map((finding) => finding.suggestedPromptDelta ?? '')

const FindingRow = ({
  finding,
  selection,
}: {
  readonly finding: ReviewFinding
  readonly selection?: FindingSelection
}) => {
  const moment = formatEvidenceMoment(finding.evidence)
  // 選択欄は差分の表示の中にしか出ない。差分が無ければ枠ごと出ないので、
  // ここで isCorrectable を重ねて呼ばない（同じ判断を 2 箇所に置かない）。
  const checked = selection !== undefined && selection.selectedIds.includes(finding.id)

  return (
    <li className="rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${findingSeverityClassName(finding.severity)}`}
        >
          {findingSeverityLabel(finding.severity)}
        </span>
        <span className="text-xs font-medium text-text">{reviewerLabel(finding.reviewer)}</span>
        {moment !== null && (
          <span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs text-text">
            {moment}
          </span>
        )}
        {finding.score !== null && (
          <span className="text-xs text-muted">スコア {finding.score.toFixed(2)}</span>
        )}
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text">{finding.message}</p>

      {finding.suggestedPromptDelta !== null && (
        <div className="mt-3 rounded bg-surface-2 p-3">
          <p className="text-xs font-semibold text-muted">再生成時のプロンプト追加</p>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-text">
            {finding.suggestedPromptDelta}
          </p>

          {selection !== undefined && (
            <label className="mt-2 flex items-center gap-2 text-xs text-text">
              <input
                type="checkbox"
                checked={checked}
                disabled={selection.disabled ?? false}
                onChange={() => {
                  selection.onToggle(finding.id)
                }}
                className="accent-accent"
              />
              <span>この直しを次の生成に足す</span>
            </label>
          )}
        </div>
      )}
    </li>
  )
}

export const ReviewFindingList = ({ findings, selection }: ReviewFindingListProps) => {
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
        <FindingRow key={finding.id} finding={finding} selection={selection} />
      ))}
    </ul>
  )
}
