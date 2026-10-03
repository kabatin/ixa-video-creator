'use client'

import type { MediaAssetId, ProjectId, RenderPreset } from '@ixa/domain'
import { useMemo, useState } from 'react'
import { RenderCheckSummary, type RenderCheck } from '@/components/render-check-summary'
import {
  RenderFolderButton,
  RenderFolderLocation,
  RenderFolderNotice,
  useRenderFolder,
} from '@/components/render-folder'
import { RenderJobList } from '@/components/render-job-list'
import { RenderRejected } from '@/components/render-rejected'
import { RenderPresetField, RenderRangeField } from '@/components/render-settings'
import { TimelineIssuePanel } from '@/components/timeline-issue-panel'
import { Button } from '@/components/ui/button'
import { useRenderWatch, type RenderWatch } from '@/components/workbench/use-render-watch'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { createRenderApi, type RenderApi, type RenderRejection, type WireRenderJob } from '@/lib/render-api'
import { DEFAULT_RENDER_PRESET } from '@/lib/render-display'
import type { RenderFolderApi } from '@/lib/render-folder-api'
import type { RenderRangeChoice } from '@/lib/render-range'
import { createRequester } from '@/lib/requester'
import type { TimelineIssueView } from '@/lib/timeline-issues'
import { WORDING } from '@/lib/wording'

/**
 * 書き出し（レンダリング）の投入と見守り（P55-3）。**左で書き出し、右でこれまでの書き出し**
 * （制作者 2026-10-03「書き出し画面で生成された動画があるフォルダを開く導線が欲しい。UI/UX が雑な印象」）。
 *
 * レンダリングは**数分かかる**。押したあと放置して戻ってきた人が、
 * 動いているのか・終わったのか・失敗したのかを一目で分かるようにする。
 * そのために「まだ始まっていない」「進捗の報告が無い」「失敗した」を
 * 別の言葉で出す（判定は `render-display.ts`。lessons L-015）。
 *
 * **追いかける仕事はこのパネルが持たない。** `use-render-watch.ts` が持つ。
 * ダイアログを閉じるとこのパネルは unmount されるので、ここに置くと追跡が消える。
 * `watch` を渡せば外の見守りに相乗りし、省略すれば自分で 1 つ作る。
 *
 * 検査の判定は**サーバ**（`validateTimeline`）が正。ここは件数を数えて出すだけ。
 */

export type RenderPanelProps = {
  readonly projectId: ProjectId
  /** null は「読めていない」。0 件と混ぜない。 */
  readonly initialJobs: readonly WireRenderJob[] | null
  readonly jobsError: string | null
  /** 投入前の検査の結果。**null は「検査できていない」**であって指摘 0 件ではない。 */
  readonly issues: readonly TimelineIssueView[] | null
  /** 検査を読めなかった理由。 */
  readonly issuesError?: string | null
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
  /** 「タイムラインで直す」。無ければボタンを出さない。 */
  readonly onFixTimeline?: () => void
  /** テストや Storybook から差し替えるための注入口。 */
  readonly api?: RenderApi
  readonly folderApi?: RenderFolderApi
  readonly resolveOutputUrl?: (assetId: MediaAssetId) => Promise<string>
}

type Feedback = { readonly tone: 'success' | 'error'; readonly message: string }

const defaultApi = (): RenderApi => createRenderApi(createRequester(resolveApiBaseUrl()))

const defaultResolveOutputUrl = async (assetId: MediaAssetId): Promise<string> =>
  (await createApiClient().mediaUrl(assetId)).url

const acceptedMessage = (warningCount: number): string =>
  warningCount === 0
    ? '書き出しを受け付けました。数分かかります。右の一覧が自動で更新されます。'
    : `警告 ${String(warningCount)} 件つきで受け付けました。絵が欠ける可能性があります。`

const countOf = (issues: readonly TimelineIssueView[] | null, severity: TimelineIssueView['severity']) =>
  issues === null ? null : issues.filter((issue) => issue.severity === severity).length

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
  return watch === undefined ? <SelfWatchedRenderPanel {...props} /> : <RenderPanelView {...props} watch={watch} />
}

type RenderPanelViewProps = RenderPanelProps & { readonly watch: RenderWatch }

const RenderPanelView = ({
  projectId,
  issues,
  issuesError = null,
  timelineDurationSec,
  watch,
  range = null,
  onFixTimeline,
  api,
  folderApi,
  resolveOutputUrl,
}: RenderPanelViewProps) => {
  const client = useMemo<RenderApi>(() => api ?? defaultApi(), [api])
  const toOutputUrl = useMemo(() => resolveOutputUrl ?? defaultResolveOutputUrl, [resolveOutputUrl])
  const folder = useRenderFolder(projectId, folderApi)

  const [preset, setPreset] = useState<RenderPreset>(DEFAULT_RENDER_PRESET)
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [rejection, setRejection] = useState<RenderRejection | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  // チェックして開いたら、最初から「選んだ Shot だけ」。
  const [onlyRange, setOnlyRange] = useState(range?.preferred ?? false)
  const chosenRange = onlyRange ? range : null
  // 範囲だけなら、範囲で数えた件数で止める（範囲の外の指摘では止めない）。
  const check: RenderCheck =
    chosenRange === null
      ? { errors: countOf(issues, 'error'), warnings: countOf(issues, 'warning') }
      : { errors: chosenRange.blockingIssueCount, warnings: chosenRange.warningIssueCount }
  const blocked = check.errors !== null && check.errors > 0

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

  return (
    <div className="grid gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
      <section aria-label="書き出す" className="flex flex-col gap-5 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        <RenderRangeField
          range={range}
          onlyRange={onlyRange}
          onChange={setOnlyRange}
          timelineDurationSec={timelineDurationSec}
          disabled={submitting}
        />
        <RenderPresetField preset={preset} onChange={setPreset} disabled={submitting} />
        <RenderCheckSummary
          check={check}
          details={<TimelineIssuePanel issues={issues} projectId={projectId} />}
          {...(onFixTimeline === undefined ? {} : { onFixTimeline })}
        />
        {issuesError !== null && (
          <p role="alert" className="text-xs text-danger">
            {issuesError}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <div className="grid">
            <Button tone="primary" disabled={submitting || blocked} onClick={() => void submit()}>
              {submitting ? '送信中…' : '書き出す'}
            </Button>
          </div>
          {feedback !== null && (
            <p
              role={feedback.tone === 'error' ? 'alert' : 'status'}
              className={`text-sm ${feedback.tone === 'error' ? 'text-danger' : 'text-ok'}`}
            >
              {feedback.message}
            </p>
          )}
          {/* **閉じても追跡は続く。** 言っておかないと、消えたのか動いているのか分からないまま閉じることになる。 */}
          {watch.active.length > 0 && (
            <p role="status" className="text-xs text-muted">
              {`${String(watch.active.length)} 件の書き出しが動いています。この画面を閉じても続きます。`}
            </p>
          )}
        </div>
        {rejection !== null && <RenderRejected rejection={rejection} />}
      </section>

      <section
        aria-label="これまでの書き出しの一覧"
        className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-line lg:pl-6"
      >
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text">これまでの書き出し</h3>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={refreshing || submitting} onClick={() => void reload()}>
                {refreshing ? '確認中…' : WORDING.refresh}
              </Button>
              <RenderFolderButton folder={folder} />
            </div>
          </div>
          <RenderFolderLocation folder={folder} />
        </div>
        <RenderFolderNotice folder={folder} />
        {watch.note !== null && (
          <p role="status" className="text-xs text-warn">
            {watch.note === 'timeout'
              ? `${String(Math.round(watch.timeoutMs / 60_000))} 分待っても終わらないため自動更新を止めました。終わったかどうかは分かっていません。`
              : '状態を引き直せなくなったため自動更新を止めました。'}
            {`「${WORDING.refresh}」を押してください。`}
          </p>
        )}
        <RenderJobList
          jobs={watch.jobs}
          error={watch.error}
          nowMs={watch.nowMs}
          resolveOutputUrl={toOutputUrl}
          folder={folder}
          highlightJobId={watch.watchedJobId}
        />
      </section>
    </div>
  )
}
