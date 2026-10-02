'use client'

import type { MediaAssetId, ProjectId, RenderPreset } from '@ixa/domain'
import { useMemo, useState } from 'react'
import { RenderJobList } from '@/components/render-job-list'
import { Button } from '@/components/ui/button'
import { useRenderWatch, type RenderWatch } from '@/components/workbench/use-render-watch'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { formatDuration } from '@/lib/format-time'
import type { RenderRangeChoice } from '@/lib/render-range'
import { createRenderApi, type RenderApi, type RenderRejection } from '@/lib/render-api'
import type { WireRenderJob } from '@/lib/render-api'
import {
  DEFAULT_RENDER_PRESET,
  describeRenderJob,
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
 * **追いかける仕事はこのパネルが持たない。** `use-render-watch.ts` が持つ。
 * ダイアログを閉じるとこのパネルは unmount されるので、ここに置くと追跡が消える。
 * `watch` を渡せば外の見守りに相乗りし、省略すれば自分で 1 つ作る（従来どおり）。
 *
 * 投入前の検査結果の表示は**ページ側（サーバ）が担当する**。
 * ここが使うのは「error が何件あるか」だけで、判定規則は持たない。
 */

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
  /**
   * 走っている書き出しの見守り。**ダイアログより長生きする場所で作ったものを渡す。**
   * 省略するとこのパネルが自分で作る＝閉じると追跡が止まる。
   */
  readonly watch?: RenderWatch
  /**
   * 選んだ Shot だけを書き出す範囲（制作者 2026-10-02「選択した Shot だけを動画として出力」）。
   * null / 省略なら Shot を選んでいないので、全体だけ。
   */
  readonly range?: RenderRangeChoice | null
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
        <p className="mt-1 text-sm text-danger">
          理由が分かりませんでした。もう一度書き出すと直ることがあります。
        </p>
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

/**
 * 見守りを外から渡されなかったときだけ、このパネルが 1 つ作る。
 * **フックを条件分岐の中で呼ばない**ため、殻を分けている。
 */
const SelfWatchedRenderPanel = (props: RenderPanelProps) => {
  const watch = useRenderWatch({
    projectId: props.projectId,
    initialJobs: props.initialJobs,
    initialError: props.jobsError,
    api: props.api,
  })
  return <RenderPanelView {...props} watch={watch} />
}

export const RenderPanel = (props: RenderPanelProps) => {
  const { watch } = props
  return watch === undefined ? (
    <SelfWatchedRenderPanel {...props} />
  ) : (
    <RenderPanelView {...props} watch={watch} />
  )
}

type RenderPanelViewProps = RenderPanelProps & { readonly watch: RenderWatch }

const RenderPanelView = ({
  projectId,
  blockingIssueCount,
  timelineDurationSec,
  watch,
  range = null,
  api,
  resolveOutputUrl,
}: RenderPanelViewProps) => {
  const client = useMemo<RenderApi>(() => api ?? defaultApi(), [api])
  const toOutputUrl = useMemo(() => resolveOutputUrl ?? defaultResolveOutputUrl, [resolveOutputUrl])

  const [preset, setPreset] = useState<RenderPreset>(DEFAULT_RENDER_PRESET)
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [rejection, setRejection] = useState<RenderRejection | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [outputs, setOutputs] = useState<Readonly<Record<string, string>>>({})
  const [pendingOutputId, setPendingOutputId] = useState<string | null>(null)

  // チェックして開いたら、最初から「選んだ Shot だけ」。
  const [onlyRange, setOnlyRange] = useState(range?.preferred ?? false)
  const chosenRange = onlyRange ? range : null
  // 範囲だけなら、範囲で数えた件数で止める（範囲の外の指摘では止めない）。
  const blockingCount = chosenRange === null ? blockingIssueCount : chosenRange.blockingIssueCount
  const blocked = blockingCount !== null && blockingCount > 0

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    setRejection(null)
    setFeedback(null)
    try {
      const outcome = await client.startRender(projectId, preset, chosenRange?.scope)
      if (outcome.kind === 'rejected') {
        setRejection(outcome.rejection)
        return
      }
      // 見守りに預ける。**この画面を閉じても追跡は続く。**
      watch.watchJob(outcome.renderJobId)
      setFeedback({ tone: 'success', message: acceptedMessage(outcome.warnings.length) })
      await watch.refresh()
    } catch (caught) {
      setFeedback({ tone: 'error', message: describeForPerson(caught) })
    } finally {
      setSubmitting(false)
    }
  }

  const reload = async (): Promise<void> => {
    setRefreshing(true)
    await watch.refresh()
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
          message: `出力の URL を取得できませんでした: ${describeForPerson(caught)}`,
        })
      } finally {
        setPendingOutputId(null)
      }
    })()
  }

  const jobs = watch.jobs
  const watched = jobs === null ? null : (jobs.find((job) => job.id === watch.watchedJobId) ?? null)
  const shown = watched ?? (jobs === null ? null : latestRenderJob(jobs))
  const shownView = shown === null ? null : describeRenderJob(shown)
  const presetHint = RENDER_PRESET_OPTIONS.find((option) => option.value === preset)?.hint ?? ''

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-base font-semibold text-text">書き出す</h2>
        <p className="mt-1 text-sm text-muted">
          {'タイムラインを 1 本の動画にします。'}
          {timelineDurationSec === null
            ? '長さを読み込めませんでした。'
            : `いまの長さは ${formatDuration(timelineDurationSec)} です。`}
          {range === null && 'Shot を選んでから開くと、その Shot だけを書き出せます。'}
        </p>

        {range !== null && (
          <fieldset className="mt-4 flex flex-col gap-2" disabled={submitting}>
            <legend className="text-sm font-medium text-text">範囲</legend>
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="radio"
                name="render-range"
                checked={!onlyRange}
                onChange={() => {
                  setOnlyRange(false)
                }}
              />
              全体
            </label>
            <label className="flex flex-wrap items-center gap-x-2 text-sm text-text">
              <input
                type="radio"
                name="render-range"
                checked={onlyRange}
                onChange={() => {
                  setOnlyRange(true)
                }}
              />
              選んだ Shot だけ
              <span className="font-medium">{range.label}</span>
              <span className="tabular-nums text-muted">{range.span}</span>
            </label>
            {range.extraNote !== null && <p className="pl-6 text-xs text-muted">{range.extraNote}</p>}
          </fieldset>
        )}

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
              {`レンダリング不可の指摘が ${String(blockingCount ?? 0)} 件あるため、まだ書き出せません。`}
            </p>
          )}
          {blockingCount === null && (
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

        {/*
          **閉じても追跡は続く。** それを押した人に言っておかないと、
          消えたのか動いているのか分からないまま閉じることになる。
        */}
        {watch.active.length > 0 && (
          <p role="status" className="mt-4 text-sm text-text">
            {`${String(watch.active.length)} 件の書き出しが動いています。この画面を閉じても続きます。`}
          </p>
        )}

        {shownView !== null && (
          <p
            role={shownView.phase === 'failed' ? 'alert' : 'status'}
            className="mt-4 rounded-md border border-line bg-surface-2 p-3 text-sm text-text"
          >
            {`最後の書き出し（${shownView.statusLabel}）: ${shownView.detail}`}
          </p>
        )}

        {watch.note !== null && (
          <p role="status" className="mt-2 text-sm text-warn">
            {watch.note === 'timeout'
              ? `${String(Math.round(watch.timeoutMs / 60_000))} 分待っても終わらないため自動更新を止めました。終わったかどうかは分かっていません。`
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
            error={watch.error}
            nowMs={watch.nowMs}
            outputs={outputs}
            pendingOutputId={pendingOutputId}
            onOpenOutput={openOutput}
            highlightJobId={watch.watchedJobId}
          />
        </div>
      </section>
    </div>
  )
}
