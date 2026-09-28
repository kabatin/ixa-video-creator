import { planMerge, planSplit, type Shot } from '@ixa/domain'
import type { WorkbenchContextValue } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { formatClock } from '@/lib/format-time'

/**
 * Shot の分割・結合の「押せるか」と「分割の実行」（ADR-0024）。
 * メニューと ⌘K の両方がここを通す。規則は `@ixa/domain` の `planSplit` / `planMerge`。
 */

export const splitBlockerOf = (current: Shot | null, atSec: number): string | null => {
  if (current === null) return 'Shot を選んでいません'
  const plan = planSplit(current, atSec)
  return plan.ok ? null : plan.reason
}

export const mergeBlockerOf = (checked: readonly Shot[]): string | null => {
  if (checked.length < 2) return 'Shot を 2 件以上チェックしてください'
  const plan = planMerge(checked)
  return plan.ok ? null : plan.reason
}

type SplitPort = Pick<WorkbenchContextValue, 'notify' | 'refresh'>

/** 再生位置で割る。**結合で戻せるので確認は挟まない。** 結果は上端の知らせに出す。 */
export const splitAtPlayhead = (workbench: SplitPort, current: Shot | null, atSec: number): void => {
  const blocker = splitBlockerOf(current, atSec)
  if (current === null || blocker !== null) {
    workbench.notify(`分割できません: ${blocker ?? ''}`)
    return
  }
  createApiClient()
    .splitShot(current.id, atSec)
    .then((result) => {
      workbench.notify(`${current.code} を ${formatClock(atSec)} で分割し、後半を ${result.second.code} にしました。`)
      workbench.refresh()
    })
    .catch((cause: unknown) => {
      workbench.notify(`${current.code} を分割できませんでした: ${describeError(cause)}`)
    })
}
