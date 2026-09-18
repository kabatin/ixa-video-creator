'use client'

import type { MediaAssetId, ProjectId, RenderPreset } from '@ixa/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RenderJobList } from '@/components/render-job-list'
import { Button } from '@/components/ui/button'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { formatDuration } from '@/lib/format-time'
import { startAsyncPolling } from '@/lib/poller'
import {
  createRenderApi,
  type RenderApi,
  type RenderRejection,
  type WireRenderJob,
} from '@/lib/render-api'
import {
  DEFAULT_RENDER_PRESET,
  describeRenderJob,
  isRenderJobActive,
  latestRenderJob,
  RENDER_PRESET_OPTIONS,
  summarizeReasons,
} from '@/lib/render-display'
import { createRequester } from '@/lib/requester'
import { WORDING } from '@/lib/wording'

/**
 * 書き出し（レンダリング）の投入と見守り（P55-3）。
 *
 * レンダリングは**数分かかる**。押したあと放置して戻ってきた人が、
 * 動いているのか・終わったのか・失敗したのかを一目で分かるようにする。
 * そのために「まだ始まっていない」「進捗の報告が無い」「失敗した」を
 * 別の言葉で出す（判定は `render-display.ts`。lessons L-015）。
 *
 * 投入前の検査結果の表示は**ページ側（サーバ）が担当する**。
 * ここが使うのは「error が何件あるか」だけで、判定規則は持たない。
 */

/** 数分かかる処理なので、1 秒ごとに叩かない。 */
export const RENDER_POLL_INTERVAL_MS = 5_000

/** 4K は長い。既定の 5 分では足りないので延ばす。超えたら止めて理由を出す。 */
export const RENDER_POLL_TIMEOUT_MS = 30 * 60 * 1_000

export type RenderPanelProps = {
  readonly projectId: ProjectId
  /** null は「読めていない」。0 件と混ぜない。 */
  readonly initialJobs: readonly WireRenderJob[] | null
  readonly jobsError: string | null
  /**
   * 投入前の検査で見つかった「レンダリング不可」の件数。
   * **null は「検査できていない」**であって 0 件ではない。
   */
  readonly blockingIssueCount: number | null
  /** 書き出される長さ。読めなければ null。 */
  readonly timelineDurationSec: number | null
  /** テストや Storybook から差し替えるための注入口。 */
  readonly api?: RenderApi
  readonly resolveOutputUrl?: (assetId: MediaAssetId) => Promise<string>
}

type Feedback = { readonly tone: 'success' | 'error'; readonly message: string }

const defaultApi = (): RenderApi => createRenderApi(createRequester(resolveApiBaseUrl()))

const defaultResolveOutputUrl = async (assetId: MediaAssetId): Promise<string> =>
  (await createApiClient().mediaUrl(assetId)).url

const acceptedMessage = (warningCount: number): string =>
  warningCount === 0
    ? '書き出しを受け付けました。数分かかります。この画面は自動で更新されます。'
    : `警告 ${String(warningCount)} 件つきで受け付けました。絵が欠ける可能性があります。`

/** 拒否理由はフィールドごとに件数を残したまま、先頭だけ出す。72 件を全部並べても読めない。 */
const Rejected = ({ rejection }: { readonly rejection: RenderRejection }) => {
  const entries = Object.entries(rejection.fields)
  return (
    <section role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-4">
      <h3 className="text-sm font-semibold text-danger">{`書き出しを受け付けられませんでした: ${rejection.message}`}</h3>
      {entries.length === 0 && (
        <p className="mt-1 text-sm text-danger">理由が返っていません。API のログを確認してください。</p>
      )}
      {entries.map(([field, reasons]) => {
        const summary = summarizeReasons(reasons)
        return (
          <div key={field} className="mt-2">
            <p className="text-sm font-medium text-danger">{`${field}: ${String(summary.total)} 件`}</p>
            <ul className="mt-1 flex flex-col gap-0.5 pl-4 text-xs text-danger">
              {summary.shown.map((reason) => (
                <li key={reason} className="list-disc break-words">
                  {reason}
                </li>
              ))}
              {summary.hiddenCount > 0 && (
                <li className="list-none">{`ほか ${String(summary.hiddenCount)} 件`}</li>
              )}
            </ul>
          </div>
        )
      })}
    </section>
  )
}

export const RenderPanel = ({
  projectId,
  initialJobs,
  jobsError,
  blockingIssueCount,
  timelineDurationSec,
  api,
  resolveOutputUrl,
}: RenderPanelProps) => {
  const client = useMemo<RenderApi>(() => api ?? defaultApi(), [api])
  const toOutputUrl = useMemo(() => resolveOutputUrl ?? defaultResolveOutputUrl, [resolveOutputUrl])

  const [preset, setPreset] = useState<RenderPreset>(DEFAULT_RENDER_PRESET)
  const [jobs, setJobs] = useState<readonly WireRenderJob[] | null>(initialJobs)
  const [loadError, setLoadError] = useState<string | null>(jobsError)
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [rejection, setRejection] = useState<RenderRejection | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [watchedJobId, setWatchedJobId] = useState<string | null>(null)
  const [outputs, setOutputs] = useState<Readonly<Record<string, string>>>({})
  const [pendingOutputId, setPendingOutputId] = useState<string | null>(null)
  // 最初の描画ではサーバとブラウザで値が変わるため「いま」を持たない。
  const [nowMs, setNowMs] = useState<number | null>(null)
  /** 自動更新が止まった理由。**「終わった」と「諦めた」と「引けなくなった」を混ぜない。** */
  const [pollNote, setPollNote] = useState<'timeout' | 'failed' | null>(null)

  const hasActive = (jobs ?? []).some((job) => isRenderJobActive(job.status))
  const blocked = blockingIssueCount !== null && blockingIssueCount > 0

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await client.listRenderJobs(projectId)
      setJobs(next)
      setLoadError(null)
      setNowMs(Date.now())
    } catch (caught) {
      // 一覧を空に畳まない。読めていないことを残す（lessons L-015）。
      setLoadError(describeError(caught))
    }
  }, [client, projectId])

  useEffect(() => {
    setNowMs(Date.now())
  }, [])

  /**
   * 動いているジョブがある間だけ引き直す。終わったら自分で止まる。
   * 止まった理由は分けて出す。まとめて「終わり」にすると、
   * 諦めただけのものを完了だと見せてしまう（lessons L-015）。
   */
  useEffect(() => {
    if (!hasActive) return undefined
    setPollNote(null)
    const handle = startAsyncPolling<readonly WireRenderJob[]>({
      intervalMs: RENDER_POLL_INTERVAL_MS,
      timeoutMs: RENDER_POLL_TIMEOUT_MS,
      probe: async () => {
        const next = await client.listRenderJobs(projectId)
        return { running: next.some((job) => isRenderJobActive(job.status)), value: next }
      },
      onProbe: ({ value }) => {
        setJobs(value)
        setLoadError(null)
        setNowMs(Date.now())
      },
      onTimeout: () => {
        setPollNote('timeout')
      },
      onFailed: (caught) => {
        setLoadError(describeError(caught))
        setPollNote('failed')
      },
    })
    return () => {
      handle.stop()
    }
  }, [hasActive, client, projectId])

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    setRejection(null)
    setFeedback(null)
    try {
      const outcome = await client.startRender(projectId, preset)
      if (outcome.kind === 'rejected') {
        setRejection(outcome.rejection)
        return
      }
      setWatchedJobId(outcome.renderJobId)
      setFeedback({ tone: 'success', message: acceptedMessage(outcome.warnings.length) })
      await refresh()
    } catch (caught) {
      setFeedback({ tone: 'error', message: describeError(caught) })
    } finally {
      setSubmitting(false)
    }
  }

  const reload = async (): Promise<void> => {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  const openOutput = (job: WireRenderJob): void => {
    if (job.outputAssetId === null) return
    const assetId = job.outputAssetId
    setPendingOutputId(job.id)
    setFeedback(null)
    void (async () => {
      try {
        const url = await toOutputUrl(assetId)
        setOutputs((current) => ({ ...current, [job.id]: url }))
      } catch (caught) {
        setFeedback({
          tone: 'error',
          message: `出力の URL を取得できませんでした: ${describeError(caught)}`,
        })
      } finally {
        setPendingOutputId(null)
      }
    })()
  }

  const watched = jobs === null ? null : (jobs.find((job) => job.id === watchedJobId) ?? null)
  const shown = watched ?? (jobs === null ? null : latestRenderJob(jobs))
  const shownView = shown === null ? null : describeRenderJob(shown)
  const presetHint = RENDER_PRESET_OPTIONS.find((option) => option.value === preset)?.hint ?? ''

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-base font-semibold text-text">書き出す</h2>
        <p className="mt-1 text-sm text-muted">
          {'タイムライン全体を 1 本の動画にします。'}
          {timelineDurationSec === null
            ? '長さを読み込めませんでした。'
            : `いまの長さは ${formatDuration(timelineDurationSec)} です。`}
          {'範囲や Shot 単位の部分書き出しはまだ出せないため、選べません。'}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <label htmlFor="render-preset" className="text-sm font-medium text-text">
            プリセット
          </label>
          <select
            id="render-preset"
            value={preset}
            disabled={submitting}
            onChange={(event) => {
              setPreset(event.target.value as RenderPreset)
            }}
            className="w-full max-w-sm rounded-md border border-line-strong px-3 py-2 text-sm"
          >
            {RENDER_PRESET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">{presetHint}</p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            tone="primary"
            disabled={submitting || blocked}
            onClick={() => {
              void submit()
            }}
          >
            {submitting ? '送信中…' : `書き出しを${WORDING.start}`}
          </Button>
          <Button
            disabled={refreshing || submitting}
            onClick={() => {
              void reload()
            }}
          >
            {refreshing ? '確認中…' : WORDING.refresh}
          </Button>

          {blocked && (
            <p role="status" className="text-sm text-danger">
              {`レンダリング不可の指摘が ${String(blockingIssueCount ?? 0)} 件あるため、まだ書き出せません。`}
            </p>
          )}
          {blockingIssueCount === null && (
            <p role="status" className="text-sm text-warn">
              投入前の検査ができていません。サーバ側の検査で拒否される可能性があります。
            </p>
          )}
          {feedback !== null && (
            <p
              role={feedback.tone === 'error' ? 'alert' : 'status'}
              className={`text-sm ${feedback.tone === 'error' ? 'text-danger' : 'text-ok'}`}
            >
              {feedback.message}
            </p>
          )}
        </div>

        {shownView !== null && (
          <p
            role={shownView.phase === 'failed' ? 'alert' : 'status'}
            className="mt-4 rounded-md border border-line bg-surface-2 p-3 text-sm text-text"
          >
            {`最後の書き出し（${shownView.statusLabel}）: ${shownView.detail}`}
          </p>
        )}

        {pollNote !== null && (
          <p role="status" className="mt-2 text-sm text-warn">
            {pollNote === 'timeout'
              ? `${String(RENDER_POLL_TIMEOUT_MS / 60_000)} 分待っても終わらないため自動更新を止めました。終わったかどうかは分かっていません。`
              : '状態を引き直せなくなったため自動更新を止めました。'}
            {`「${WORDING.refresh}」を押してください。`}
          </p>
        )}
      </section>

      {rejection !== null && <Rejected rejection={rejection} />}

      <section>
        <h2 className="text-base font-semibold text-text">これまでの書き出し</h2>
        <div className="mt-3">
          <RenderJobList
            jobs={jobs}
            error={loadError}
            nowMs={nowMs}
            outputs={outputs}
            pendingOutputId={pendingOutputId}
            onOpenOutput={openOutput}
            highlightJobId={watchedJobId}
          />
        </div>
      </section>
    </div>
  )
}
