import type { Shot, ShotStatus, TakeId } from '@ixa/domain'
import { ShotStatusBadge } from '@/components/shot-status-badge'
import { formatCamera, formatSeconds } from '@/lib/shot-display'

export type ShotSummaryProps = {
  readonly shot: Shot
  /** 生成・採用で変わるため、最新の値を親から受け取る。 */
  readonly status: ShotStatus
  readonly selectedTakeId: TakeId | null
}

export const ShotSummary = ({ shot, status, selectedTakeId }: ShotSummaryProps) => (
  <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-slate-900">{shot.code}</h2>
      <ShotStatusBadge status={status} />
    </div>
    <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm text-slate-700 sm:grid-cols-3">
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-400">開始</dt>
        <dd className="tabular-nums">{formatSeconds(shot.startSec)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-400">尺</dt>
        <dd className="tabular-nums">{formatSeconds(shot.durationSec)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-400">生成方式</dt>
        <dd>{shot.sourceType.type}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs uppercase tracking-wide text-slate-400">カメラ</dt>
        <dd>{formatCamera(shot.camera)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-400">mood</dt>
        <dd>{shot.mood ?? '—'}</dd>
      </div>
      <div className="sm:col-span-3">
        <dt className="text-xs uppercase tracking-wide text-slate-400">説明</dt>
        <dd className="whitespace-pre-wrap break-words">
          {shot.description === '' ? '—' : shot.description}
        </dd>
      </div>
      <div className="sm:col-span-3">
        <dt className="text-xs uppercase tracking-wide text-slate-400">採用中の Take</dt>
        <dd>{selectedTakeId ?? '未採用'}</dd>
      </div>
    </dl>
  </section>
)
