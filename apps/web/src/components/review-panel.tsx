'use client'

import type { HumanVerdict, ReviewFinding, Take, TakeId } from '@ixa/domain'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReviewFindingList } from '@/components/review-finding-list'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { formatClock } from '@/lib/format-time'
import { POLL_TIMEOUT_MS, startAsyncPolling, type PollHandle } from '@/lib/poller'
import { type HumanDecision, type ReviewApi, type WireReviewRun } from '@/lib/review-api'
import {
  humanDecisionLabel,
  isReviewRunPending,
  latestReviewRun,
  reviewRunStatusLabel,
  reviewVerdictClassName,
  reviewVerdictLabel,
  summarizeFindings,
  summarizeRun,
} from '@/lib/review-display'
import { humanVerdictLabel } from '@/lib/shot-display'
import { WORDING } from '@/lib/wording'

/**
 * Take 1 件のレビュー結果表示と、人間の最終判断（P4-6）。
 *
 * レビューは worker が非同期で走る。**実行ボタンは完了を待たない。**
 * 以前はそこで止まっていたので、利用者が「結果を確認」を押すまで
 * 終わったかどうかが分からなかった。いまは待機中・実行中の run を自動で追いかける。
 *
 * 追いかけている状態は 5 つを混ぜない。追っていない / 待っている / 終わった /
 * 上限まで待った / 問い合わせに失敗した。
 * 特に「上限まで待った」を「終わった」にしない（lessons L-015）。
 * 失敗は必ず画面に出し、「押したのに何も起きない」を作らない。
 */

export type ReviewPanelProps = {
  readonly takeId: TakeId
  /** 保存済みの人手判定。保存に成功したらこの画面の表示が優先される。 */
  readonly humanVerdict: HumanVerdict
  /** 生成中など、他の操作で画面が動いている間は触らせない。 */
  readonly disabled?: boolean
  readonly onVerdictSaved?: (take: Take) => void
  /** テストや Storybook から差し替えるための注入口。既定は既存の API クライアント。 */
  readonly api?: ReviewApi
}

type LoadState =
  | { readonly kind: 'loading' }
  /** レビューがまだ 1 度も走っていない。失敗と区別する。 */
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready'
      readonly run: WireReviewRun
      readonly findings: readonly ReviewFinding[]
    }
  | { readonly kind: 'error'; readonly message: string }

/** 完了を追いかけている状態。`off` は「追っていない」で、「終わった」ではない。 */
type WatchState =
  | { readonly kind: 'off' }
  | { readonly kind: 'watching'; readonly startedAtMs: number; readonly elapsedMs: number }
  | { readonly kind: 'settled' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'failed'; readonly message: string }

type Feedback = { readonly tone: 'success' | 'error'; readonly message: string }

const FEEDBACK_CLASS = {
  success: 'text-emerald-700',
  error: 'text-rose-700',
} as const

const DECISIONS: readonly HumanDecision[] = ['approved', 'rejected']

const WATCH_OFF: WatchState = { kind: 'off' }

const timeoutMinutes = (): string => String(Math.round(POLL_TIMEOUT_MS / 60_000))

/**
 * 既定の呼び出し口。**API クライアントの組み立ては 1 箇所に寄せる**
 * （base URL の決め方が 2 通りあると、片方だけ直して食い違う）。
 */
const defaultApi = (): ReviewApi => createApiClient()

const loadLatest = async (api: ReviewApi, takeId: TakeId): Promise<LoadState> => {
  const runs = await api.listReviewRuns(takeId)
  const latest = latestReviewRun(runs)
  if (latest === null) return { kind: 'empty' }

  const detail = await api.getReviewRun(latest.id)
  return { kind: 'ready', run: detail.run, findings: detail.findings }
}

/**
 * まだ動いているか。
 * `empty` を「動いている」とみなすのは**積んだ直後だけ**。run の行が出るまでの間があるため。
 * 画面を開いた時点の `empty` は「まだ 1 度も走っていない」なので、そもそも追いかけない。
 */
const stillRunning = (state: LoadState): boolean =>
  state.kind === 'empty' || (state.kind === 'ready' && isReviewRunPending(state.run.status))

const RunSummary = ({
  run,
  findings,
}: {
  readonly run: WireReviewRun
  readonly findings: readonly ReviewFinding[]
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${reviewVerdictClassName(run.verdict)}`}
    >
      {reviewVerdictLabel(run.verdict)}
    </span>
    <span className="text-xs text-slate-600">{reviewRunStatusLabel(run.status)}</span>
    <span className="text-sm text-slate-700">{summarizeRun(run, summarizeFindings(findings))}</span>
  </div>
)

const WatchNotice = ({ watch }: { readonly watch: WatchState }) => {
  switch (watch.kind) {
    case 'off':
    case 'settled':
      return null
    case 'watching':
      return (
        <p role="status" className="text-sm text-slate-700">
          {`レビューの完了を待っています（経過 ${formatClock(watch.elapsedMs / 1_000)}）。終わったら自動で更新します。`}
        </p>
      )
    case 'timeout':
      return (
        <p role="alert" className="text-sm text-amber-800">
          {`${timeoutMinutes()} 分待ちましたが終わりませんでした。追いかけるのをやめます。「${WORDING.refresh}」で引き直すか、worker のログを確認してください。`}
        </p>
      )
    case 'failed':
      return (
        <p role="alert" className="text-sm text-rose-700">
          {`結果を追いかけられなくなりました: ${watch.message}`}
        </p>
      )
  }
}

export const ReviewPanel = ({
  takeId,
  humanVerdict,
  disabled = false,
  onVerdictSaved,
  api,
}: ReviewPanelProps) => {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [watch, setWatch] = useState<WatchState>(WATCH_OFF)
  const [reloadKey, setReloadKey] = useState(0)
  const [requesting, setRequesting] = useState(false)
  const [savingVerdict, setSavingVerdict] = useState<HumanDecision | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  // 保存に成功するまでは親から渡された値を表示する。保存後はこちらが優先する。
  const [savedVerdict, setSavedVerdict] = useState<HumanVerdict | null>(null)
  const pollRef = useRef<PollHandle | null>(null)

  // 毎レンダーで作り直すと effect が回り続ける。注入された api が変わらない限り固定する。
  const client = useMemo<ReviewApi>(() => api ?? defaultApi(), [api])
  const currentVerdict = savedVerdict ?? humanVerdict
  const busy = disabled || requesting || savingVerdict !== null

  const startWatching = useCallback(() => {
    pollRef.current?.stop()
    const startedAtMs = Date.now()
    setWatch({ kind: 'watching', startedAtMs, elapsedMs: 0 })
    pollRef.current = startAsyncPolling<LoadState>({
      probe: async () => {
        const next = await loadLatest(client, takeId)
        return { running: stillRunning(next), value: next }
      },
      onProbe: (probe) => {
        setState(probe.value)
        setWatch((current) =>
          current.kind === 'watching'
            ? { ...current, elapsedMs: Date.now() - current.startedAtMs }
            : current,
        )
      },
      onSettled: () => {
        setWatch({ kind: 'settled' })
      },
      onTimeout: () => {
        setWatch({ kind: 'timeout' })
      },
      onFailed: (caught) => {
        setWatch({ kind: 'failed', message: describeError(caught) })
      },
    })
  }, [client, takeId])

  // 画面を離れたらポーリングを止める。止め忘れはリクエストの垂れ流しになる。
  useEffect(
    () => () => {
      pollRef.current?.stop()
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })

    const run = async (): Promise<void> => {
      try {
        const next = await loadLatest(client, takeId)
        if (cancelled) return
        setState(next)
        // 開いた時点で走っている run があれば、そのまま追いかける。
        // `empty`（1 度も走っていない）は追いかけない。押してもいない処理を待たせない。
        if (next.kind === 'ready' && isReviewRunPending(next.run.status)) startWatching()
      } catch (caught) {
        if (!cancelled) setState({ kind: 'error', message: describeError(caught) })
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [client, takeId, reloadKey, startWatching])

  const reload = useCallback(() => {
    pollRef.current?.stop()
    setWatch(WATCH_OFF)
    setReloadKey((key) => key + 1)
  }, [])

  const requestReview = async (): Promise<void> => {
    setRequesting(true)
    setFeedback(null)
    try {
      await client.requestReview(takeId)
      startWatching()
    } catch (caught) {
      setFeedback({ tone: 'error', message: describeError(caught) })
    } finally {
      setRequesting(false)
    }
  }

  const saveVerdict = async (decision: HumanDecision): Promise<void> => {
    setSavingVerdict(decision)
    setFeedback(null)
    try {
      const take = await client.setTakeVerdict(takeId, decision)
      setSavedVerdict(take.humanVerdict)
      setFeedback({ tone: 'success', message: `${humanDecisionLabel(decision)}しました。` })
      onVerdictSaved?.(take)
    } catch (caught) {
      setFeedback({ tone: 'error', message: describeError(caught) })
    } finally {
      setSavingVerdict(null)
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">自動レビューと判断</h2>
        <span className="text-xs text-slate-600">{humanVerdictLabel(currentVerdict)}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          tone="primary"
          disabled={busy || watch.kind === 'watching'}
          onClick={() => {
            void requestReview()
          }}
        >
          {requesting ? '送信中…' : `レビューを${WORDING.start}`}
        </Button>

        <Button disabled={busy} onClick={reload}>
          {WORDING.refresh}
        </Button>

        <WatchNotice watch={watch} />
      </div>

      <div className="mt-5">
        {state.kind === 'loading' && (
          <p role="status" className="text-sm text-slate-600">
            レビュー結果を読み込んでいます…
          </p>
        )}

        {state.kind === 'empty' && (
          <p className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            この Take はまだレビューされていません。
          </p>
        )}

        {state.kind === 'error' && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            レビュー結果を取得できませんでした: {state.message}
          </p>
        )}

        {state.kind === 'ready' && (
          <div className="flex flex-col gap-3">
            <RunSummary run={state.run} findings={state.findings} />
            {isReviewRunPending(state.run.status) && watch.kind !== 'watching' && (
              <p role="status" className="text-sm text-slate-600">
                {`レビューは実行中です。「${WORDING.refresh}」で引き直してください。`}
              </p>
            )}
            <ReviewFindingList findings={state.findings} />
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        {DECISIONS.map((decision) => (
          <Button
            key={decision}
            tone={decision === 'approved' ? 'primary' : 'secondary'}
            disabled={busy || currentVerdict === decision}
            onClick={() => {
              void saveVerdict(decision)
            }}
          >
            {savingVerdict === decision ? '保存中…' : humanDecisionLabel(decision)}
          </Button>
        ))}

        {feedback !== null && (
          <p
            role={feedback.tone === 'error' ? 'alert' : 'status'}
            className={`text-sm ${FEEDBACK_CLASS[feedback.tone]}`}
          >
            {feedback.message}
          </p>
        )}
      </div>
    </section>
  )
}
