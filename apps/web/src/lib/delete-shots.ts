import type { Shot, ShotId } from '@ixa/domain'
import { formatSpan } from '@/lib/format-time'
import { deleteConfirmMessage } from '@/lib/wording'

/**
 * Shot の削除で「何を消すか」を決める（制作者の要望 2026-09-26）。
 *
 * **チェックがあればチェックした Shot、無ければ選んでいる Shot。** メニュー・Delete キー・
 * 一括操作バーはすべてここを通す。以前はメニューの「選択を削除」だけで、消えるのは
 * 選んでいる 1 件だった。「選択」がチェックのことにも読め、チェックして押すと
 * 別の 1 件が消えうる。何を消すかは項目名と確認の文で必ず言う。
 */

/** 確認の文に並べるコードの上限。多いと文が画面を埋める。 */
const MAX_LISTED_CODES = 5

export const resolveDeleteTargets = (
  shots: readonly Shot[],
  checked: ReadonlySet<ShotId>,
  selectedShotId: ShotId | null,
): readonly Shot[] =>
  checked.size > 0
    ? shots.filter((shot) => checked.has(shot.id))
    : shots.filter((shot) => shot.id === selectedShotId)

export const deleteMenuLabel = (checkedCount: number): string =>
  checkedCount > 0 ? `チェックした ${String(checkedCount)} 件を削除…` : 'この Shot を削除…'

export const describeDeleteTargets = (targets: readonly Shot[]): string => {
  const [only] = targets
  if (targets.length === 1 && only !== undefined) {
    return deleteConfirmMessage(`Shot ${only.code} ${formatSpan(only.startSec, only.durationSec)}`)
  }
  const listed = targets.slice(0, MAX_LISTED_CODES).map((shot) => shot.code)
  const rest = targets.length - listed.length
  const codes = rest > 0 ? `${listed.join('、')} ほか ${String(rest)} 件` : listed.join('、')
  return deleteConfirmMessage(`${String(targets.length)} 件の Shot（${codes}）`)
}

export type DeleteResult =
  | { readonly shotId: string; readonly ok: true }
  | { readonly shotId: string; readonly ok: false; readonly reason: string }

/** 結果の知らせ。**消せなかった Shot は黙らず**、コードと理由を言う。 */
export const summarizeDeleteResults = (
  shots: readonly Shot[],
  results: readonly DeleteResult[],
): string => {
  const deleted = results.filter((result) => result.ok).length
  const failures = results.flatMap((result) => {
    if (result.ok) return []
    const code = shots.find((shot) => shot.id === result.shotId)?.code ?? result.shotId
    return [`${code}（${result.reason}）`]
  })
  const head = `${String(deleted)} 件の Shot を削除しました。`
  return failures.length === 0
    ? head
    : `${head}${String(failures.length)} 件は削除できませんでした: ${failures.join('、')}`
}
