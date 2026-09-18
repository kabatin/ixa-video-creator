'use client'

import { ShotSize, type ProjectId, type Shot } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  BulkActionBar,
  type BulkGenerateInput,
  type BulkModelOption,
  type BulkOutcome,
  type BulkSelectOption,
  type BulkTakeRule,
  type BulkUpdatePatch,
} from '@/components/bulk-action-bar'
import { ShotTable } from '@/components/shot-table'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { SHOT_SIZE_OPTIONS } from '@/lib/camera-options'
import { MODEL_OPTIONS } from '@/lib/generation-options'
import {
  clearSelection,
  EMPTY_SELECTION,
  headerCheckboxState,
  planBulkOperation,
  pruneSelection,
  selectAllVisible,
  summarizeBulkResult,
  toggleShot,
  type BulkPlan,
  type ShotSelection,
} from '@/lib/shot-bulk'
import { parseBulkGenerateRejection, type BulkGenerateRejection } from '@/lib/shot-bulk-api'

/**
 * Shot 一覧の操作場（P58）。選ぶ・行の中で直す・まとめて動かす、を 1 画面で行う。
 *
 * 制作者は 27 件に対して詳細との往復を 54 回した（2026-09-18）。
 * **一覧から出ずに済むこと**がこの部品の存在理由。
 *
 * 判定は `shot-bulk.ts`、部品は `bulk-action-bar` / `inline-text-cell`。
 * ここは状態を持って繋ぐだけで、規則を書かない。
 */

export type ShotListWorkspaceProps = {
  readonly projectId: ProjectId
  readonly initialShots: readonly Shot[]
  readonly locationOptions: readonly BulkSelectOption[]
}

/** 選べるモデル。いまは AUTO だけだが、選択肢の正は `generation-options` に置いたまま。 */
const MODEL_CHOICES: readonly BulkModelOption[] = MODEL_OPTIONS.flatMap((option) =>
  option.value === 'AUTO' ? [{ value: 'AUTO' as const, label: option.label }] : [],
)

const replaceShot = (shots: readonly Shot[], next: Shot): readonly Shot[] =>
  shots.map((shot) => (shot.id === next.id ? next : shot))

export const ShotListWorkspace = ({
  projectId,
  initialShots,
  locationOptions,
}: ShotListWorkspaceProps) => {
  const router = useRouter()
  const api = useMemo(() => createApiClient(), [])

  const [shots, setShots] = useState<readonly Shot[]>(initialShots)
  const [selection, setSelection] = useState<ShotSelection>(EMPTY_SELECTION)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const visibleIds = useMemo(() => shots.map((shot) => shot.id), [shots])
  const headerState = headerCheckboxState(selection, visibleIds)
  const chosen = shots.filter((shot) => selection.has(shot.id))

  // --- 行の中で直す ---

  /**
   * 保存に成功したら手元の一覧を差し替える。**部品は確定値を持たない**ので、
   * ここで差し替えないと読む姿に古い値が残る。失敗は reject のまま部品へ返し、部品が理由を出す。
   */
  const saveDescription = async (shot: Shot, next: string): Promise<void> => {
    const updated = await api.updateShot(shot.id, { description: next })
    setShots((current) => replaceShot(current, updated))
    router.refresh()
  }

  const saveMood = async (shot: Shot, next: string): Promise<void> => {
    // 空欄は「未設定」。空文字を保存すると「空という指定」と区別がつかなくなる。
    const updated = await api.updateShot(shot.id, { mood: next.trim() === '' ? null : next })
    setShots((current) => replaceShot(current, updated))
    router.refresh()
  }

  // --- まとめて動かす ---

  /** 送る前に止まったものを結果に混ぜて出す。黙って減らさない（L-015）。 */
  const blockedLines = (plan: BulkPlan): readonly string[] =>
    plan.blocked.map((note) => `${note.code} — ${note.message}`)

  const runBulk = async (
    plan: BulkPlan,
    action: () => Promise<{ readonly summary: string; readonly failures: readonly string[] }>,
  ): Promise<void> => {
    if (plan.targetIds.length === 0) {
      setOutcome({
        summary: '送れる Shot がありません。',
        failures: blockedLines(plan),
      })
      return
    }
    setBusy(true)
    setOutcome(null)
    try {
      const result = await action()
      setOutcome({ summary: result.summary, failures: [...result.failures, ...blockedLines(plan)] })
      router.refresh()
    } catch (error) {
      setOutcome({ summary: `実行できませんでした: ${describeError(error)}`, failures: [] })
    } finally {
      setBusy(false)
    }
  }

  const generate = (input: BulkGenerateInput): void => {
    const plan = planBulkOperation('generate', selection, shots)
    void runBulk(plan, async () => {
      try {
        const result = await api.bulkGenerateShots(projectId, {
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
        setShots((current) =>
          current.map((shot) =>
            summary.succeededIds.has(shot.id) ? { ...shot, status: 'generating' } : shot,
          ),
        )
        return { summary: summary.headline, failures: summary.failures.map(noteLine) }
      } catch (error) {
        /**
         * 予算超過は**1 件も投入されていない**。普通の失敗と同じ文にすると、
         * 一部だけ走ったのかと不安にさせる。合計と上限を必ず添える。
         */
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
    const plan = planBulkOperation('select-take', selection, shots)
    void runBulk(plan, async () => {
      const result = await api.bulkSelectTakes(projectId, { shotIds: [...plan.targetIds], rule })
      const summary = summarizeBulkResult('select-take', result.results, shots)
      setShots((current) =>
        current.map((shot) => {
          const hit = result.results.find((entry) => entry.ok && entry.shotId === shot.id)
          return hit !== undefined && hit.ok
            ? { ...shot, selectedTakeId: hit.takeId, status: hit.status }
            : shot
        }),
      )
      return { summary: summary.headline, failures: summary.failures.map(noteLine) }
    })
  }

  const update = (patch: BulkUpdatePatch): void => {
    const plan = planBulkOperation('update', selection, shots)
    void runBulk(plan, async () => {
      const result = await api.bulkUpdateShots(projectId, {
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
      setShots((current) =>
        current.map((shot) => {
          const hit = result.results.find((entry) => entry.ok && entry.shotId === shot.id)
          return hit !== undefined && hit.ok ? hit.shot : shot
        }),
      )
      return { summary: summary.headline, failures: summary.failures.map(noteLine) }
    })
  }

  return (
    <div className="space-y-4 pb-32">
      {rowError !== null && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {rowError}
        </p>
      )}

      <ShotTable
        shots={shots}
        isSelected={(shot) => selection.has(shot.id)}
        headerState={headerState}
        busy={busy}
        onToggle={(shot) => {
          setSelection((current) => toggleShot(current, shot.id))
        }}
        onToggleAll={() => {
          setSelection((current) =>
            headerCheckboxState(current, visibleIds) === 'all'
              ? clearSelection()
              : selectAllVisible(visibleIds),
          )
        }}
        onSaveDescription={(shot, next) =>
          saveDescription(shot, next).catch((error: unknown) => {
            setRowError(`${shot.code} の説明を保存できませんでした: ${describeError(error)}`)
            throw error
          })
        }
        onSaveMood={(shot, next) =>
          saveMood(shot, next).catch((error: unknown) => {
            setRowError(`${shot.code} の mood を保存できませんでした: ${describeError(error)}`)
            throw error
          })
        }
      />

      <BulkActionBar
        selectedCount={chosen.length}
        alreadySelectedCount={chosen.filter((shot) => shot.selectedTakeId !== null).length}
        lockedCount={chosen.filter((shot) => shot.lockedAt !== null).length}
        modelOptions={MODEL_CHOICES}
        cameraSizeOptions={SHOT_SIZE_OPTIONS}
        locationOptions={locationOptions}
        busy={busy}
        outcome={outcome}
        onGenerate={generate}
        onSelectTakes={selectTakes}
        onUpdate={update}
        onClearSelection={() => {
          setSelection(pruneSelection(clearSelection(), visibleIds))
          setOutcome(null)
        }}
      />
    </div>
  )
}

const noteLine = (note: { readonly code: string; readonly message: string }): string =>
  `${note.code} — ${note.message}`

/** どの上限を緩めれば通るか。利用者が次に取る行動が変わるので、当たった上限を名指しする。 */
const LIMIT_LABELS: Readonly<Record<NonNullable<BulkGenerateRejection['limit']>, string>> = {
  project_budget: 'プロジェクトの予算',
  shot: 'Shot ごとの累積上限',
  request: '1 回の依頼の上限',
}

/**
 * 予算超過の金額の言い方。
 * **「上限なし」と「上限が分からない」を混ぜない**（L-015）。前者は選択を減らしても
 * 直らない（当たったのは別の上限）、後者は数字を出さない、と対処が逆になる。
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
