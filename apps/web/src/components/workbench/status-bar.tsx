'use client'

import type { Project } from '@ixa/domain'
import { useEffect, useState } from 'react'
import { CostMeterPanel } from '@/components/cost-meter'
import { LiveStatusBadge } from '@/components/live-status-badge'
import { useTransport, type WorkbenchLive } from '@/components/workbench/workbench-context'
import { TRANSPORT_OWNER_LABELS } from '@/lib/transport-labels'
import type { RenderWatch } from '@/components/workbench/use-render-watch'
import { formatClock } from '@/lib/format-time'
import { describeRenderJob } from '@/lib/render-display'
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
  /**
   * 走っている書き出し。**ダイアログを閉じてもここに残る。**
   * 以前は追跡がダイアログの中だけにあり、閉じると「いま書き出している」が
   * どこにも出なくなって、終わったことに気づけなかった。
   */
  readonly renderWatch: RenderWatch
}

/**
 * 走っている書き出しの 1 行。**割合が取れないときは書かない**（偽の進捗を出さない）。
 * 2 件以上あれば件数だけにする（バーは 1 行しかない）。
 */
const describeActiveRenders = (watch: RenderWatch): string => {
  if (watch.active.length > 1) return `書き出し中 ${String(watch.active.length)} 件`
  const job = watch.active[0]
  if (job === undefined) return ''
  const view = describeRenderJob(job)
  return view.progressPercent === null
    ? `書き出し中（${view.statusLabel}）`
    : `書き出し中 ${String(view.progressPercent)}%`
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
export const StatusBar = ({
  project,
  shotCount,
  live,
  loadErrors,
  renderWatch,
}: StatusBarProps) => {
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
      {/**
        * **画面でただひとつの再生操作。**
        *
        * 以前はパネルごとに再生ボタンがあり、「聴きながら切る」とプレビューを
        * 同時に開くと同じ見た目のボタンが縦に 2 つ並んだ。どちらが何を鳴らすのか
        * 区別が無く、押す側は選べない。裏のタブでも鳴り続けるので、
        * パネルを見ても止める場所が分からなかった。**常にここにある。**
        */}
      <PlaybackControls />
      {/* 走っている書き出し。閉じたダイアログの中で終わっても、ここで気づける。 */}
      {renderWatch.active.length > 0 && (
        <span className="text-info">{describeActiveRenders(renderWatch)}</span>
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

/**
 * 鳴っている場所。**裏のタブでも鳴り続ける**ので、パネルを見ても分からず、
 * 音を止める場所を探す羽目になっていた。ここが唯一それを言う。
 *
 * 再生ボタンは**見えているプレイヤーの直下**（`transport-bar.tsx`）、
 * 音量は**上の帯の右**（`volume-control.tsx`）。画面の最下段はどちらの定位置でもない。
 */
const PlaybackControls = () => {
  // **ここだけが再生位置を読む。** バー全体に渡すと、バーごと毎フレーム描き直す。
  const transport = useTransport()
  if (!transport.playing || transport.owner === null) return null
  return (
    <span className="text-accent">
      {`▶ ${TRANSPORT_OWNER_LABELS[transport.owner]} ${formatClock(transport.currentSec)}`}
    </span>
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
