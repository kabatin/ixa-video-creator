import type { RenderScope, Shot, ShotId } from '@ixa/domain'
import { overlapsRange } from '@ixa/timeline'
import { formatSpan } from '@/lib/format-time'
import { resolveShotTargets } from '@/lib/shot-targets'
import { sortShotsByStart } from '@/lib/timeline-display'
import type { WireTimelineIssue } from '@/lib/timeline-api'

/**
 * 選んだ Shot だけを書き出す範囲（制作者 2026-10-02「途中までを誰かに見せたい時のために選択した Shot だけを動画として出力」）。
 * **React を含まない。**
 *
 * - 対象は削除と同じ（`resolveShotTargets`。チェックがあればチェックした Shot、無ければ選んでいる 1 件）
 * - 範囲は一番前の頭から一番後ろの終わりまで。飛び飛びなら間の Shot も入る（音楽を途切れさせないため）
 * - 止める指摘は、範囲に掛かる Shot と Shot に紐づかないものだけ（区間の判定は API と同じ `@ixa/timeline`）
 */

/** 間に入る Shot のコードを並べる上限。多いと文が画面を埋める。 */
const MAX_LISTED_CODES = 4

export type RenderRangeChoice = {
  readonly scope: Extract<RenderScope, { type: 'range' }>
  /** `CUT-02〜CUT-03`（1 件なら `CUT-02`）。 */
  readonly label: string
  /** `0:04.00 – 0:12.00（8.00s）`。 */
  readonly span: string
  /** 選んでいないのに入る Shot の知らせ。無ければ null。 */
  readonly extraNote: string | null
  /** 範囲で数えた「書き出しを止める指摘」の件数。**null は検査を読めていない**（0 件と混ぜない）。 */
  readonly blockingIssueCount: number | null
  /** 範囲で数えた警告（書き出せるが絵が欠けるかもしれない）。**null は検査を読めていない。** */
  readonly warningIssueCount: number | null
  /** 最初から選んでおくか（チェックして開いたとき）。 */
  readonly preferred: boolean
}

const listCodes = (shots: readonly Shot[]): string =>
  shots.length <= MAX_LISTED_CODES
    ? shots.map((shot) => shot.code).join('・')
    : `${shots[0]?.code ?? ''}〜${shots[shots.length - 1]?.code ?? ''} など ${String(shots.length)} 件`

export const renderRangeChoice = (input: {
  readonly shots: readonly Shot[]
  readonly checked: ReadonlySet<ShotId>
  readonly selectedShotId: ShotId | null
  readonly issues: readonly WireTimelineIssue[] | null
}): RenderRangeChoice | null => {
  const targets = sortShotsByStart([...resolveShotTargets(input.shots, input.checked, input.selectedShotId)])
  const first = targets[0]
  if (first === undefined) return null
  const last = targets.reduce((latest, shot) =>
    shot.startSec + shot.durationSec > latest.startSec + latest.durationSec ? shot : latest,
  )
  const range = { startSec: first.startSec, endSec: last.startSec + last.durationSec }
  const included = sortShotsByStart(input.shots.filter((shot) => overlapsRange(shot, range)))
  const chosen = new Set(targets.map((shot) => shot.id))
  const extra = included.filter((shot) => !chosen.has(shot.id))
  const inRange = new Set<string>(included.map((shot) => shot.id))
  const countInRange = (severity: WireTimelineIssue['severity']): number | null =>
    input.issues === null
      ? null
      : input.issues.filter(
          (issue) => issue.severity === severity && (issue.shotId === undefined || inRange.has(issue.shotId)),
        ).length

  return {
    scope: { type: 'range', start: range.startSec, end: range.endSec },
    label: first.id === last.id ? first.code : `${first.code}〜${last.code}`,
    span: formatSpan(range.startSec, range.endSec - range.startSec),
    extraNote: extra.length === 0 ? null : `間の ${listCodes(extra)} も入ります`,
    blockingIssueCount: countInRange('error'),
    warningIssueCount: countInRange('warning'),
    preferred: input.checked.size > 0,
  }
}

/** 書き出しの履歴に添える範囲。全体なら null（今までどおり何も添えない）。 */
export const renderScopeLabel = (scope: RenderScope): string | null =>
  scope.type === 'range' ? `一部 ${formatSpan(scope.start, scope.end - scope.start)}` : null
