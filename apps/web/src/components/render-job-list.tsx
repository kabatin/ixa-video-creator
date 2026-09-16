import { Button } from '@/components/ui/button'
import { formatClock } from '@/lib/format-time'
import type { WireRenderJob } from '@/lib/render-api'
import {
  describeRenderJob,
  formatJobTime,
  renderElapsedSec,
  renderPresetLabel,
  sortRenderJobsByNewest,
} from '@/lib/render-display'

/**
 * 書き出しの履歴（`GET /projects/{id}/renders`）。
 *
 * **`jobs` が null は「読めていない」であって「1 件も無い」ではない。**
 * 同じ見た目にすると、失敗した読み込みを「まだ書き出していない」と読み違える
 * （lessons L-015）。
 *
 * 経過時間は `nowMs` を受け取って計算する。ここで `Date.now()` を呼ぶと、
 * サーバで描いた HTML とブラウザの最初の描画がずれる。
 */

export type RenderJobListProps = {
  readonly jobs: readonly WireRenderJob[] | null
  readonly error: string | null
  /** 画面が持っている「いま」。未確定（描画前）なら null。 */
  readonly nowMs: number | null
  /** 取得済みの出力 URL（RenderJob.id → 署名付き URL）。 */
  readonly outputs: Readonly<Record<string, string>>
  /** 出力 URL を取得中のジョブ。 */
  readonly pendingOutputId: string | null
  readonly onOpenOutput: (job: WireRenderJob) => void
  /** いま追いかけているジョブ。一覧の中で見失わないよう印を付ける。 */
  readonly highlightJobId?: string | null
}

const ProgressBar = ({ percent }: { readonly percent: number }) => (
  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
    <div className="h-full rounded-full bg-sky-600" style={{ width: `${String(percent)}%` }} />
  </div>
)

const JobRow = ({
  job,
  nowMs,
  outputs,
  pendingOutputId,
  onOpenOutput,
  highlighted,
}: {
  readonly job: WireRenderJob
  readonly nowMs: number | null
  readonly outputs: RenderJobListProps['outputs']
  readonly pendingOutputId: string | null
  readonly onOpenOutput: RenderJobListProps['onOpenOutput']
  readonly highlighted: boolean
}) => {
  const view = describeRenderJob(job)
  const outputUrl = outputs[job.id]
  const border = highlighted ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white'

  return (
    <li className={`rounded-lg border p-4 ${border}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${view.statusClassName}`}
        >
          {view.statusLabel}
        </span>
        <span className="text-sm font-medium text-slate-900">{renderPresetLabel(job.preset)}</span>
        <span className="text-xs text-slate-500">{formatJobTime(job.createdAt)}</span>
        {nowMs !== null && (
          <span className="text-xs text-slate-500">
            {job.finishedAt === null ? '経過 ' : 'かかった時間 '}
            {formatClock(renderElapsedSec(job, nowMs))}
          </span>
        )}
      </div>

      <p
        role={view.phase === 'failed' ? 'alert' : 'status'}
        className={`mt-2 text-sm ${view.phase === 'failed' ? 'text-red-800' : 'text-slate-700'}`}
      >
        {view.detail}
      </p>

      {view.progressPercent !== null && view.isActive && (
        <div className="mt-2">
          <ProgressBar percent={view.progressPercent} />
        </div>
      )}

      {job.status === 'succeeded' && job.outputAssetId !== null && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={pendingOutputId === job.id}
            onClick={() => {
              onOpenOutput(job)
            }}
          >
            {pendingOutputId === job.id ? '取得中…' : '出力を開く'}
          </Button>
          {outputUrl !== undefined && (
            <a
              href={outputUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-sky-800 underline hover:text-sky-950"
            >
              別のタブで再生・ダウンロード
            </a>
          )}
        </div>
      )}

      {outputUrl !== undefined && (
        <video
          controls
          preload="metadata"
          src={outputUrl}
          className="mt-3 w-full max-w-xl rounded-md border border-slate-200 bg-black"
        >
          <track kind="captions" />
        </video>
      )}
    </li>
  )
}

export const RenderJobList = ({
  jobs,
  error,
  nowMs,
  outputs,
  pendingOutputId,
  onOpenOutput,
  highlightJobId = null,
}: RenderJobListProps) => {
  if (jobs === null) {
    return (
      <section role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
        <h3 className="text-sm font-semibold text-red-900">書き出しの履歴を読み込めませんでした</h3>
        <p className="mt-1 text-sm text-red-800">
          {error ?? '理由が記録されていません。'}
          これは「まだ 1 件も書き出していない」ではありません。
        </p>
      </section>
    )
  }

  if (jobs.length === 0) {
    return (
      <p role="status" className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600">
        このプロジェクトはまだ 1 度も書き出していません。
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {sortRenderJobsByNewest(jobs).map((job) => (
        <JobRow
          key={job.id}
          job={job}
          nowMs={nowMs}
          outputs={outputs}
          pendingOutputId={pendingOutputId}
          onOpenOutput={onOpenOutput}
          highlighted={job.id === highlightJobId}
        />
      ))}
    </ul>
  )
}
