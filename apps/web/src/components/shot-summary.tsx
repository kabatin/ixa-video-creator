import type { Shot, ShotStatus, TakeId } from '@ixa/domain'
import { ShotEditor } from '@/components/shot-editor'
import { ShotStatusBadge } from '@/components/shot-status-badge'
import { formatClock, formatDuration } from '@/lib/format-time'
import { formatCamera, isGeneratingStatus } from '@/lib/shot-display'

export type ShotSummaryProps = {
  readonly shot: Shot
  /** 生成・採用で変わるため、最新の値を親から受け取る。 */
  readonly status: ShotStatus
  readonly selectedTakeId: TakeId | null
  /**
   * 表示用のロケーション名。ID から名前への解決は一覧を持つ親にしかできないため、
   * ここでは解決済みの文字列だけを受け取り、この節は表示に徹する。
   */
  readonly locationLabel: string
}

export const ShotSummary = ({ shot, status, selectedTakeId, locationLabel }: ShotSummaryProps) => (
  <div className="space-y-6">
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">{shot.code}</h2>
        <ShotStatusBadge status={status} />
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm text-slate-700 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">開始</dt>
          <dd className="tabular-nums">{formatClock(shot.startSec)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">尺</dt>
          <dd className="tabular-nums">{formatDuration(shot.durationSec)}</dd>
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
          <dt className="text-xs uppercase tracking-wide text-slate-400">ロケーション</dt>
          <dd className="break-words">{locationLabel}</dd>
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

    {/*
      生成中は Take が増える途中なので、尺や開始秒を動かさせない。
      判定は親が持つ最新の status から引く（新しい props を増やさずに済む）。
    */}
    <ShotEditor shot={shot} disabled={isGeneratingStatus(status)} />
  </div>
)
