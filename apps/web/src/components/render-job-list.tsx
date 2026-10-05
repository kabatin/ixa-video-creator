import type { MediaAssetId } from '@ixa/domain'
import { useState } from 'react'
import type { RenderFolder } from '@/components/render-folder'
import { Button } from '@/components/ui/button'
import { describeForPerson } from '@/lib/api-error'
import { formatElapsed } from '@/lib/format-time'
import type { WireRenderJob } from '@/lib/render-api'
import {
  describeRenderJob,
  formatJobTime,
  renderElapsedSec,
  renderLoudnessNote,
  renderPresetLabel,
  sortRenderJobsByNewest,
} from '@/lib/render-display'
import { renderScopeLabel } from '@/lib/render-range'

/**
 * 書き出しの履歴（`GET /projects/{id}/renders`）。1 件 1 行にまとめ、完了したものはその場で再生でき、
 * Finder でその動画を選んで開ける（ADR-0036）。
 *
 * **`jobs` が null は「読めていない」であって「1 件も無い」ではない。**
 * 同じ見た目にすると、失敗した読み込みを「まだ書き出していない」と読み違える（lessons L-015）。
 *
 * 経過時間は `nowMs` を受け取って計算する。ここで `Date.now()` を呼ぶと描画ごとに揺れる。
 */

export type RenderJobListProps = {
  readonly jobs: readonly WireRenderJob[] | null
  readonly error: string | null
  /** 画面が持っている「いま」。未確定（描画前）なら null。 */
  readonly nowMs: number | null
  /** 出力の再生用 URL を都度もらう（署名付き URL は持ち続けない）。 */
  readonly resolveOutputUrl: (assetId: MediaAssetId) => Promise<string>
  /** Finder で開く口。 */
  readonly folder: RenderFolder
  /** いま追いかけているジョブ。一覧の中で見失わないよう印を付ける。 */
  readonly highlightJobId?: string | null
}

const ProgressBar = ({ percent }: { readonly percent: number }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
    <div className="h-full rounded-full bg-info" style={{ width: `${String(percent)}%` }} />
  </div>
)

type Player = { readonly state: 'closed' } | { readonly state: 'loading' } | { readonly state: 'open'; readonly url: string }

const JobRow = ({
  job,
  nowMs,
  resolveOutputUrl,
  folder,
  highlighted,
}: {
  readonly job: WireRenderJob
  readonly nowMs: number | null
  readonly resolveOutputUrl: RenderJobListProps['resolveOutputUrl']
  readonly folder: RenderFolder
  readonly highlighted: boolean
}) => {
  const view = describeRenderJob(job)
  const [player, setPlayer] = useState<Player>({ state: 'closed' })
  const [playError, setPlayError] = useState<string | null>(null)
  const output = job.status === 'succeeded' ? job.outputAssetId : null
  const loudness = renderLoudnessNote(job)

  const togglePlayer = (): void => {
    if (player.state !== 'closed' || output === null) {
      setPlayer({ state: 'closed' })
      return
    }
    setPlayer({ state: 'loading' })
    setPlayError(null)
    resolveOutputUrl(output)
      .then((url) => setPlayer({ state: 'open', url }))
      .catch((cause: unknown) => {
        setPlayer({ state: 'closed' })
        setPlayError(`動画を読み込めませんでした: ${describeForPerson(cause)}`)
      })
  }

  return (
    <li className={`rounded-md border p-3 ${highlighted ? 'border-info/60 bg-info/5' : 'border-line bg-surface'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${view.statusClassName}`}>
          {view.statusLabel}
        </span>
        <span className="text-sm font-medium text-text">{renderPresetLabel(job.preset)}</span>
        <span className="text-xs tabular-nums text-muted">{renderScopeLabel(job.scope) ?? '全体'}</span>
        <span className="ml-auto text-xs tabular-nums text-muted">
          {formatJobTime(job.createdAt)}
          {nowMs !== null &&
            ` ・ ${job.finishedAt === null ? '経過' : 'かかった時間'} ${formatElapsed(renderElapsedSec(job, nowMs))}`}
        </span>
      </div>

      {view.phase !== 'succeeded' && (
        <p
          role={view.phase === 'failed' ? 'alert' : 'status'}
          className={`mt-2 text-sm ${view.phase === 'failed' ? 'text-danger' : 'text-text'}`}
        >
          {view.detail}
        </p>
      )}
      {view.progressPercent !== null && view.isActive && (
        <div className="mt-2">
          <ProgressBar percent={view.progressPercent} />
        </div>
      )}

      {output !== null && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={player.state === 'loading'} onClick={togglePlayer}>
            {player.state === 'closed' ? '再生' : player.state === 'loading' ? '読み込み中…' : '閉じる'}
          </Button>
          {folder.canOpen && (
            <Button size="sm" disabled={folder.opening} onClick={() => folder.open(job.id)}>
              Finder で表示
            </Button>
          )}
          {player.state === 'open' && (
            <a
              href={player.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted underline hover:text-text"
            >
              別のタブで開く
            </a>
          )}
        </div>
      )}
      {loudness !== null && <p className="mt-1 text-xs text-muted">{loudness}</p>}
      {playError !== null && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {playError}
        </p>
      )}
      {player.state === 'open' && (
        <video
          controls
          autoPlay
          preload="metadata"
          src={player.url}
          className="mt-2 w-full rounded-md border border-line bg-black"
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
  resolveOutputUrl,
  folder,
  highlightJobId = null,
}: RenderJobListProps) => {
  if (jobs === null) {
    return (
      <section role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3">
        <h4 className="text-sm font-semibold text-danger">書き出しの履歴を読み込めませんでした</h4>
        <p className="mt-1 text-sm text-danger">
          {error ?? '理由が記録されていません。'}
          これは「まだ 1 件も書き出していない」ではありません。
        </p>
      </section>
    )
  }

  if (jobs.length === 0) {
    return (
      <p role="status" className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-muted">
        まだ 1 度も書き出していません。左で範囲と画質を選んで「書き出す」を押すと、ここに並びます。
      </p>
    )
  }

  return (
    <ul aria-label="これまでの書き出し" className="flex flex-col gap-2">
      {sortRenderJobsByNewest(jobs).map((job) => (
        <JobRow
          key={job.id}
          job={job}
          nowMs={nowMs}
          resolveOutputUrl={resolveOutputUrl}
          folder={folder}
          highlighted={job.id === highlightJobId}
        />
      ))}
    </ul>
  )
}
