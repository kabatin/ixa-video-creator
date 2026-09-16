'use client'

import type { HumanVerdict, ReviewFinding, Take, TakeId } from '@ixa/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReviewFindingList } from '@/components/review-finding-list'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import {
  type HumanDecision,
  type ReviewApi,
  type WireReviewRun,
} from '@/lib/review-api'
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

/**
 * Take 1 件のレビュー結果表示と、人間の最終判断（P4-6）。
 *
 * レビューは worker が非同期で走る。**実行ボタンは完了を待たない。**
 * 受け付けたことだけを伝え、結果は「結果を確認」で引き直す。
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

type Feedback = { readonly tone: 'success' | 'error'; readonly message: string }

const FEEDBACK_CLASS = {
  success: 'text-emerald-700',
  error: 'text-rose-700',
} as const

const DECISIONS: readonly HumanDecision[] = ['approved', 'rejected']

const DECISION_CLASS: Readonly<Record<HumanDecision, string>> = {
  approved: 'bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-slate-300',
  rejected: 'bg-rose-600 text-white hover:bg-rose-500 disabled:bg-slate-300',
}

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

export const ReviewPanel = ({
  takeId,
  humanVerdict,
  disabled = false,
  onVerdictSaved,
  api,
}: ReviewPanelProps) => {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [requesting, setRequesting] = useState(false)
  const [queued, setQueued] = useState(false)
  const [savingVerdict, setSavingVerdict] = useState<HumanDecision | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  // 保存に成功するまでは親から渡された値を表示する。保存後はこちらが優先する。
  const [savedVerdict, setSavedVerdict] = useState<HumanVerdict | null>(null)

  // 毎レンダーで作り直すと effect が回り続ける。注入された api が変わらない限り固定する。
  const client = useMemo<ReviewApi>(() => api ?? defaultApi(), [api])
  const currentVerdict = savedVerdict ?? humanVerdict
  const busy = disabled || requesting || savingVerdict !== null

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })

    const run = async (): Promise<void> => {
      try {
        const next = await loadLatest(client, takeId)
        if (!cancelled) setState(next)
      } catch (caught) {
        if (!cancelled) setState({ kind: 'error', message: describeError(caught) })
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [client, takeId, reloadKey])

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1)
  }, [])

  const requestReview = async (): Promise<void> => {
    setRequesting(true)
    setFeedback(null)
    try {
      await client.requestReview(takeId)
      setQueued(true)
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
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void requestReview()
          }}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {requesting ? '送信中…' : 'レビューを実行'}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={reload}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          結果を確認
        </button>

        {queued && (
          <p role="status" className="text-sm text-slate-700">
            レビューを受け付けました。完了まで数十秒かかります。
          </p>
        )}
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
            {isReviewRunPending(state.run.status) && (
              <p role="status" className="text-sm text-slate-600">
                レビューは実行中です。「結果を確認」で引き直してください。
              </p>
            )}
            <ReviewFindingList findings={state.findings} />
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        {DECISIONS.map((decision) => (
          <button
            key={decision}
            type="button"
            disabled={busy || currentVerdict === decision}
            onClick={() => {
              void saveVerdict(decision)
            }}
            className={`rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed ${DECISION_CLASS[decision]}`}
          >
            {savingVerdict === decision ? '保存中…' : humanDecisionLabel(decision)}
          </button>
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
