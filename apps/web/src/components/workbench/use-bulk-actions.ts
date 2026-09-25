'use client'

import { ShotSize, type Shot, type ShotId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import type {
  BulkGenerateInput,
  BulkOutcome,
  BulkTakeRule,
  BulkUpdatePatch,
} from '@/components/bulk-action-bar'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { offerReviewAfterGeneration } from '@/lib/offer-review'
import { describeError } from '@/lib/api-error'
import { planBulkOperation, summarizeBulkResult, type BulkPlan } from '@/lib/shot-bulk'
import { parseBulkGenerateRejection, type BulkGenerateRejection } from '@/lib/shot-bulk-api'

/**
 * 一括操作（P58）。旧 Shot 一覧画面（`shot-list-workspace`）から移した。
 *
 * 判定は `shot-bulk.ts`、部品は `bulk-action-bar`。ここは送って結果を一覧へ映すだけ。
 * 一覧の書き換えは Provider の `replaceShots` 経由（UI-WORKBENCH §7.2）。
 */
/**
 * 投入した生成の進み具合。**投入したあとも見張る。**
 *
 * 以前は投入の往復が終わった時点で手が空き、そのあとは一覧の状態が
 * 少しずつ変わるだけだった。押したのに何も起きていないように見え、
 * 実際に「反応していない」と読み違えた。終わるまで数えて見せる。
 */
export type BulkProgress = {
  readonly done: number
  readonly total: number
}

export type BulkActions = {
  readonly busy: boolean
  readonly progress: BulkProgress | null
  readonly outcome: BulkOutcome | null
  readonly clearOutcome: () => void
  readonly generate: (input: BulkGenerateInput) => void
  readonly selectTakes: (rule: BulkTakeRule) => void
  readonly update: (patch: BulkUpdatePatch) => void
}

const noteLine = (note: { readonly code: string; readonly message: string }): string =>
  `${note.code} — ${note.message}`

/** 送る前に止まったものを結果に混ぜて出す。黙って減らさない（L-015）。 */
const blockedLines = (plan: BulkPlan): readonly string[] => plan.blocked.map(noteLine)

/** どの上限を緩めれば通るか。当たった上限を名指しする。 */
const LIMIT_LABELS: Readonly<Record<NonNullable<BulkGenerateRejection['limit']>, string>> = {
  project_budget: 'プロジェクトの予算',
  shot: 'Shot ごとの累積上限',
  request: '1 回の依頼の上限',
}

/**
 * 予算超過の金額の言い方。
 * **「上限なし」と「上限が分からない」を混ぜない**（L-015）。
 */
const describeRejectedAmounts = (rejection: BulkGenerateRejection): string => {
  const which = rejection.limit === null ? '' : `${LIMIT_LABELS[rejection.limit]}に当たりました。`
  if (rejection.estimatedTotalUsd === null) return which === '' ? '' : `（${which}）`
  const total = `見積の合計 $${rejection.estimatedTotalUsd.toFixed(2)}`
  const limit =
    rejection.limitUsd === 'unlimited'
      ? '上限なし'
      : rejection.limitUsd === null
        ? '上限は不明'
        : `上限 $${rejection.limitUsd.toFixed(2)}`
  return `（${which}${total} / ${limit}）`
}

type ActionResult = { readonly summary: string; readonly failures: readonly string[] }

export const useBulkActions = (): BulkActions => {
  const workbench = useWorkbench()
  const api = useMemo(() => createApiClient(), [])
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null)
  /** 投入した Shot。生成中でなくなったら 1 件ぶん進んだとみなす。 */
  const [watching, setWatching] = useState<readonly ShotId[] | null>(null)
  const shots: readonly Shot[] = workbench.shots ?? []

  const progress = useMemo<BulkProgress | null>(() => {
    if (watching === null) return null
    const byId = new Map(shots.map((shot) => [shot.id, shot]))
    const done = watching.filter((id) => byId.get(id)?.status !== 'generating').length
    return { done, total: watching.length }
  }, [watching, shots])

  /**
   * 全部が生成中を抜けたら見張りを終え、**自動レビューをするか聞く**。
   * 聞くのは 1 回の一括につき 1 回（件数ぶん聞かない）。結果の要約はそのまま残す。
   */
  const { notify } = workbench
  useEffect(() => {
    if (progress === null || watching === null || progress.done < progress.total) return
    const finished = watching
    setWatching(null)
    void offerReviewAfterGeneration({
      shotIds: finished,
      api,
      confirm: (message) => window.confirm(message),
      notify,
    })
  }, [progress, watching, api, notify])

  const run = async (plan: BulkPlan, action: () => Promise<ActionResult>): Promise<void> => {
    if (plan.targetIds.length === 0) {
      setOutcome({ summary: '送れる Shot がありません。', failures: blockedLines(plan) })
      return
    }
    setBusy(true)
    setOutcome(null)
    try {
      const result = await action()
      setOutcome({ summary: result.summary, failures: [...result.failures, ...blockedLines(plan)] })
      workbench.refresh()
    } catch (error) {
      setOutcome({ summary: `実行できませんでした: ${describeError(error)}`, failures: [] })
    } finally {
      setBusy(false)
    }
  }

  const generate = (input: BulkGenerateInput): void => {
    const plan = planBulkOperation('generate', workbench.checked, shots)
    void run(plan, async () => {
      try {
        const result = await api.bulkGenerateShots(workbench.projectId, {
          shotIds: [...plan.targetIds],
          model: input.model,
          count: input.count,
        })
        const summary = summarizeBulkResult(
          'generate',
          result.results,
          shots,
          result.estimatedTotalUsd,
        )
        // 投入できた Shot は生成中へ。サーバと同じ遷移を先回りして映す。
        workbench.replaceShots(
          shots.flatMap((shot) =>
            summary.succeededIds.has(shot.id) ? [{ ...shot, status: 'generating' as const }] : [],
          ),
        )
        // 投入できたぶんだけ見張る。予算で弾かれたものは最初から走っていない。
        setWatching(summary.succeededIds.size > 0 ? [...summary.succeededIds] : null)
        return { summary: summary.headline, failures: summary.failures.map(noteLine) }
      } catch (error) {
        // 予算超過は 1 件も投入されていない。合計と上限を必ず添える。
        const rejection = parseBulkGenerateRejection(error)
        if (rejection === null) throw error
        return {
          summary: `${rejection.message}${describeRejectedAmounts(rejection)} 1 件も投入していません。`,
          failures: [],
        }
      }
    })
  }

  const selectTakes = (rule: BulkTakeRule): void => {
    const plan = planBulkOperation('select-take', workbench.checked, shots)
    void run(plan, async () => {
      const result = await api.bulkSelectTakes(workbench.projectId, {
        shotIds: [...plan.targetIds],
        rule,
      })
      const summary = summarizeBulkResult('select-take', result.results, shots)
      workbench.replaceShots(
        shots.flatMap((shot) => {
          const hit = result.results.find((entry) => entry.ok && entry.shotId === shot.id)
          return hit !== undefined && hit.ok
            ? [{ ...shot, selectedTakeId: hit.takeId, status: hit.status }]
            : []
        }),
      )
      return { summary: summary.headline, failures: summary.failures.map(noteLine) }
    })
  }

  const update = (patch: BulkUpdatePatch): void => {
    const plan = planBulkOperation('update', workbench.checked, shots)
    void run(plan, async () => {
      const result = await api.bulkUpdateShots(workbench.projectId, {
        shotIds: [...plan.targetIds],
        patch: {
          ...(patch.camera === undefined
            ? {}
            : { camera: { size: ShotSize.parse(patch.camera.size) } }),
          ...(patch.mood === undefined ? {} : { mood: patch.mood }),
          ...(patch.locationId === undefined ? {} : { locationId: patch.locationId }),
        },
      })
      const summary = summarizeBulkResult('update', result.results, shots)
      workbench.replaceShots(result.results.flatMap((entry) => (entry.ok ? [entry.shot] : [])))
      return { summary: summary.headline, failures: summary.failures.map(noteLine) }
    })
  }

  return {
    busy,
    progress,
    outcome,
    clearOutcome: () => {
      setOutcome(null)
    },
    generate,
    selectTakes,
    update,
  }
}
