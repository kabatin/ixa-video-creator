'use client'

import type { ProjectId, ShotId } from '@ixa/domain'
import type { RoughCutChange } from '@ixa/timeline'
import { useCallback, useMemo, useState } from 'react'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createRequester } from '@/lib/requester'
import {
  buildRoughCutApplyView,
  buildRoughCutPlanView,
  roughCutChangeKey,
  roughCutShotLabel,
  type RoughCutApplyView,
  type RoughCutTone,
} from '@/lib/rough-cut'
import {
  createRoughCutApi,
  type RoughCutApi,
  type WireRoughCutPlan,
} from '@/lib/rough-cut-api'

/**
 * 粗編集の案を見せて、採否を人に渡す（P63-3）。
 *
 * **押すまで何も変わらない。** Undo がまだ無いので、案を作った時点では
 * Shot を 1 つも動かさない。動くのは「選んだ N 件を適用する」を押したときだけで、
 * そのことを画面にも書く。
 *
 * 適用には**画面が受け取った案をそのまま送り返す。** サーバは計算し直さない。
 * 計算し直すと、人が見た案と当たる内容が別物になる。
 *
 * 判定と言葉は `lib/rough-cut.ts` が持つ。ここは描くのと、採否を集めるだけ。
 */

/** 色は役割の名前で持つ（PHASE 5.9）。素の色名はここに書かない。 */
const SUMMARY_CLASSES: Readonly<Record<RoughCutTone, string>> = {
  ok: 'text-muted',
  warn: 'text-warn',
}

export type RoughCutPanelProps = {
  readonly projectId: ProjectId
  /** Shot の見出しに使う `code`。渡さなければ ID をそのまま出す。 */
  readonly shotCodes?: ReadonlyMap<ShotId, string>
  /** 適用が 1 件でも通ったあとに呼ばれる。親が一覧を読み直すための口。 */
  readonly onApplied?: () => void
  /** テストから差し替えるための注入口。 */
  readonly api?: RoughCutApi
}

type Phase = 'idle' | 'planning' | 'applying'

export const RoughCutPanel = ({
  projectId,
  shotCodes,
  onApplied,
  api,
}: RoughCutPanelProps) => {
  const client = useMemo(
    () => api ?? createRoughCutApi(createRequester(resolveApiBaseUrl())),
    [api],
  )

  const [phase, setPhase] = useState<Phase>('idle')
  const [plan, setPlan] = useState<WireRoughCutPlan | null>(null)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [applyView, setApplyView] = useState<RoughCutApplyView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const makePlan = useCallback(() => {
    setPhase('planning')
    setError(null)
    setApplyView(null)

    client
      .planRoughCut(projectId)
      .then((loaded) => {
        setPlan(loaded)
        // 既定では全部を選んでおく。外すのは人の判断。
        setChosen(new Set(loaded.changes.map(roughCutChangeKey)))
      })
      .catch((cause: unknown) => {
        // 握り潰さない。作れなかったことを画面に出す（規約 5 / lessons L-015）。
        setError(describeError(cause))
      })
      .finally(() => {
        setPhase('idle')
      })
  }, [client, projectId])

  const selected: readonly RoughCutChange[] =
    plan === null ? [] : plan.changes.filter((change) => chosen.has(roughCutChangeKey(change)))

  const runApply = useCallback(() => {
    if (selected.length === 0) return
    setPhase('applying')
    setError(null)

    client
      .applyRoughCut(projectId, selected)
      .then((result) => {
        setApplyView(buildRoughCutApplyView(result))
        // 当たった分は案として残さない。残すと二度押しで古い値が当たる。
        const appliedKeys = new Set(result.applied.map(roughCutChangeKey))
        setPlan((current) =>
          current === null
            ? current
            : {
                ...current,
                changes: current.changes.filter(
                  (change) => !appliedKeys.has(roughCutChangeKey(change)),
                ),
              },
        )
        if (result.applied.length > 0) onApplied?.()
      })
      .catch((cause: unknown) => {
        setError(describeError(cause))
      })
      .finally(() => {
        setPhase('idle')
      })
  }, [client, projectId, selected, onApplied])

  const toggle = useCallback((key: string) => {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const view = plan === null ? null : buildRoughCutPlanView(plan)
  const label = (shotId: ShotId): string => roughCutShotLabel(shotId, shotCodes)

  return (
    <section className="rounded-lg border border-line bg-surface p-4" aria-label="粗編集の案">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">粗編集の案</h2>
        <button
          type="button"
          onClick={makePlan}
          disabled={phase !== 'idle'}
          className="rounded border border-line px-2 py-1 text-xs text-text disabled:opacity-50"
        >
          {phase === 'planning' ? '計算中です' : '案を作る'}
        </button>
      </div>

      {/* **押すまで何も変わらない**ことを、案の有無にかかわらず常に書く。 */}
      <p className="mt-2 text-xs text-muted">
        案を作るだけでは Shot は動きません。適用を押したときだけ変わります。
      </p>

      {error === null ? null : (
        <p role="alert" className="mt-2 text-sm text-danger">
          粗編集の案を扱えませんでした（{error}）
        </p>
      )}

      {view === null ? null : (
        <>
          <p className={`mt-3 text-xs ${SUMMARY_CLASSES[view.tone]}`}>{view.summary}</p>

          {view.changes.length === 0 ? null : (
            <ul className="mt-2 space-y-2">
              {view.changes.map((change) => (
                <li key={change.key} className="rounded border border-line p-2">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={chosen.has(change.key)}
                      onChange={() => {
                        toggle(change.key)
                      }}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-text">
                        {label(change.shotId)} — {change.kindLabel}
                        <span className="ml-2 text-xs text-muted tabular-nums">
                          {change.detail}
                        </span>
                      </span>
                      {/* **なぜ動かすのかを必ず出す。** 無いと採否を決められない。 */}
                      <span className="mt-1 block text-xs text-muted">{change.reason}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {/*
            決められなかったものは、案の下に必ず並べる。
            件数に畳むと「見ていない」が「問題なし」に化ける（lessons L-015）。
          */}
          {view.unresolved.length === 0 ? null : (
            <div className="mt-3">
              <h3 className="text-xs font-semibold text-warn">
                機械が決められなかったもの（{view.unresolved.length}）
              </h3>
              <ul className="mt-1 space-y-1">
                {view.unresolved.map((entry) => (
                  <li key={entry.key} className="text-xs text-muted">
                    <span className="text-text">{label(entry.shotId)}</span> — {entry.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.hasChanges ? (
            <button
              type="button"
              onClick={runApply}
              disabled={phase !== 'idle' || selected.length === 0}
              className="mt-3 rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-50"
            >
              {phase === 'applying'
                ? '適用中です'
                : `選んだ ${selected.length.toString()} 件を適用する`}
            </button>
          ) : null}
        </>
      )}

      {applyView === null ? null : (
        <div className="mt-3 border-t border-line pt-3">
          <p className={`text-xs ${SUMMARY_CLASSES[applyView.tone]}`} role="status">
            {applyView.summary}
          </p>
          {/* 当てられなかった分は 1 件ずつ理由を出す。件数だけでは探しに行けない。 */}
          {applyView.skipped.length === 0 ? null : (
            <ul className="mt-1 space-y-1">
              {applyView.skipped.map((entry) => (
                <li key={entry.key} className="text-xs text-muted">
                  <span className="text-text">{label(entry.shotId)}</span> — {entry.kindLabel}（
                  {entry.detail}）{entry.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
