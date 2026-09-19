'use client'

import type { Project } from '@ixa/domain'
import { useEffect, useState } from 'react'
import { CostMeterPanel } from '@/components/cost-meter'
import { LiveStatusBadge } from '@/components/live-status-badge'
import type { WorkbenchLive } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { buildCostMeterView, type CostMeterView } from '@/lib/cost-meter'

export type StatusBarProps = {
  readonly project: Pick<Project, 'id' | 'resolution' | 'fps'>
  /** null は「読めていない」。0 件とは書かない（L-015）。 */
  readonly shotCount: number | null
  readonly live: WorkbenchLive
  /** 読み込みに失敗した部分。**1 件でもあれば必ず出す**（§7.3）。 */
  readonly loadErrors: readonly string[]
}

type Cost =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly view: CostMeterView }
  | { readonly state: 'error'; readonly message: string }

/**
 * ステータスバー（下。UI-WORKBENCH §3）: ライブ接続・件数・解像度・費用。
 *
 * **読めなかったことを畳まない。** 読み込みエラーは件数と先頭の理由を常に出し、
 * 全文は title と読み上げに渡す。費用は額だけを出さず、ⓘ で出どころを開ける。
 */
export const StatusBar = ({ project, shotCount, live, loadErrors }: StatusBarProps) => {
  const cost = useCost(project.id)
  const [costOpen, setCostOpen] = useState(false)

  return (
    <footer className="relative flex h-6 shrink-0 items-center gap-4 border-t border-line bg-surface px-2 text-xs text-muted">
      <LiveStatusBadge state={live.state} lastEventAt={live.lastEventAt} attempt={live.attempt} />
      {live.invalidCount > 0 && (
        <span role="alert" className="text-warn">
          {`読めない更新 ${String(live.invalidCount)} 件（表示が古い可能性があります）`}
        </span>
      )}
      <span>{shotCount === null ? 'Shot を読めていません' : `${String(shotCount)} Shots`}</span>
      <span>
        {`${String(project.resolution.width)}×${String(project.resolution.height)}・${String(project.fps)}fps`}
      </span>
      {loadErrors.length > 0 && (
        <span role="alert" title={loadErrors.join('\n')} className="min-w-0 truncate text-danger">
          {`読み込めなかった部分 ${String(loadErrors.length)} 件: ${loadErrors[0] ?? ''}`}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1">
        {cost.state === 'ready' && (
          <span title={cost.view.provenance}>{`費用 ${cost.view.measuredLabel}`}</span>
        )}
        {cost.state === 'loading' && <span>費用 —</span>}
        {cost.state === 'error' && (
          <span role="alert" title={cost.message} className="text-warn">
            費用を読めません
          </span>
        )}
        <button
          type="button"
          aria-expanded={costOpen}
          aria-label="費用の内訳"
          onClick={() => {
            setCostOpen((current) => !current)
          }}
          className="inline-flex h-6 min-w-6 items-center justify-center rounded hover:bg-surface-2 hover:text-text"
        >
          ⓘ
        </button>
      </span>
      {costOpen && (
        <div className="absolute bottom-full right-2 z-40 mb-1 w-96 max-w-[90vw] rounded-md border border-line bg-surface p-2 shadow-xl">
          <CostMeterPanel projectId={project.id} />
        </div>
      )}
    </footer>
  )
}

const useCost = (projectId: Project['id']): Cost => {
  const [cost, setCost] = useState<Cost>({ state: 'loading' })
  useEffect(() => {
    let cancelled = false
    createApiClient()
      .getCostMeter(projectId)
      .then((meter) => {
        if (!cancelled) setCost({ state: 'ready', view: buildCostMeterView(meter) })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setCost({ state: 'error', message: describeError(cause) })
      })
    return () => {
      cancelled = true
    }
  }, [projectId])
  return cost
}
