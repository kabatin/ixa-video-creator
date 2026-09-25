'use client'

import type { ReviewFinding, ReviewFindingId, ShotId, TakeId } from '@ixa/domain'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RegenerateForm, type RegenerateApi } from '@/components/regenerate-form'
import { ReviewFindingList, isCorrectable, selectedDeltas } from '@/components/review-finding-list'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { formatClock } from '@/lib/format-time'
import { POLL_TIMEOUT_MS, startAsyncPolling, type PollHandle } from '@/lib/poller'
import { type ReviewApi, type WireReviewRun } from '@/lib/review-api'
import {
  isReviewRunPending,
  latestReviewRun,
  reviewRunStatusLabel,
  reviewVerdictClassName,
  reviewVerdictLabel,
  summarizeFindings,
  summarizeRun,
} from '@/lib/review-display'
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
  /**
   * 作り直しの宛先（PHASE 6.1）。**省略できない。**
   * Take から Shot を引けなくはないが、引き忘れると指摘が生成へ戻らないまま
   * 画面だけ出来上がる。必須にして、渡し忘れを型で止める。
   */
  readonly shotId: ShotId
  /** 生成中など、他の操作で画面が動いている間は触らせない。 */
  readonly disabled?: boolean
  /** テストや Storybook から差し替えるための注入口。既定は既存の API クライアント。 */
  readonly api?: ReviewApi
  /** 作り直しを頼む口。レビューの口とは関心が違うので別に受け取る。 */
  readonly generateApi?: RegenerateApi
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
  success: 'text-ok',
  error: 'text-danger',
} as const


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
    <span className="text-xs text-muted">{reviewRunStatusLabel(run.status)}</span>
    <span className="text-sm text-text">{summarizeRun(run, summarizeFindings(findings))}</span>
  </div>
)

const WatchNotice = ({ watch }: { readonly watch: WatchState }) => {
  switch (watch.kind) {
    case 'off':
    case 'settled':
      return null
    case 'watching':
      return (
        <p role="status" className="text-sm text-text">
          {`レビューの完了を待っています（経過 ${formatClock(watch.elapsedMs / 1_000)}）。終わったら自動で更新します。`}
        </p>
      )
    case 'timeout':
      return (
        <p role="alert" className="text-sm text-warn">
          {`${timeoutMinutes()} 分待ちましたが終わりませんでした。追いかけるのをやめます。まだ続いているかもしれないので、「${WORDING.refresh}」で今の状態を確かめてください。`}
        </p>
      )
    case 'failed':
      return (
        <p role="alert" className="text-sm text-danger">
          {`結果を追いかけられなくなりました: ${watch.message}`}
        </p>
      )
  }
}

export const ReviewPanel = ({
  takeId,
  shotId,
  disabled = false,
  api,
  generateApi,
}: ReviewPanelProps) => {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [watch, setWatch] = useState<WatchState>(WATCH_OFF)
  const [reloadKey, setReloadKey] = useState(0)
  const [requesting, setRequesting] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  // 直しに使う指摘の選択と、入力欄を開いているか。Take を切り替えたら両方畳む。
  const [selectedIds, setSelectedIds] = useState<readonly ReviewFindingId[]>([])
  const [regenerating, setRegenerating] = useState(false)
  const pollRef = useRef<PollHandle | null>(null)

  // 毎レンダーで作り直すと effect が回り続ける。注入された api が変わらない限り固定する。
  const client = useMemo<ReviewApi>(() => api ?? defaultApi(), [api])
  const busy = disabled || requesting

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
    // 別の Take の指摘を選んだまま持ち越さない。足す直しが取り違えられる。
    setSelectedIds([])
    setRegenerating(false)

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

  const toggleFinding = useCallback((id: ReviewFindingId) => {
    // 破壊的変更をしない。選択は常に新しい配列で置き換える。
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((each) => each !== id) : [...current, id],
    )
  }, [])

  const findings = state.kind === 'ready' ? state.findings : []
  const correctable = findings.filter(isCorrectable)
  const deltas = selectedDeltas(findings, selectedIds)

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

  return (
    <section className="rounded-lg border border-line bg-surface p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/*
          人の「承認 / 却下」はここに置かない（ADR-0023）。**使う Take を採用することが決定。**
          以前は承認が別の操作としてここにあり、採用しても Shot が「レビュー待ち」のまま動かなかった。
        */}
        <h2 className="text-base font-semibold text-text">自動レビュー</h2>
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
          <p role="status" className="text-sm text-muted">
            レビュー結果を読み込んでいます…
          </p>
        )}

        {state.kind === 'empty' && (
          <p className="rounded-md border border-line bg-surface-2 p-4 text-sm text-muted">
            この Take はまだレビューされていません。
          </p>
        )}

        {state.kind === 'error' && (
          <p
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger"
          >
            レビュー結果を取得できませんでした: {state.message}
          </p>
        )}

        {state.kind === 'ready' && (
          <div className="flex flex-col gap-3">
            <RunSummary run={state.run} findings={state.findings} />
            {isReviewRunPending(state.run.status) && watch.kind !== 'watching' && (
              <p role="status" className="text-sm text-muted">
                {`レビューは実行中です。「${WORDING.refresh}」で引き直してください。`}
              </p>
            )}
            <ReviewFindingList
              findings={state.findings}
              /*
                入力欄を開いている間は選択を触らせない。開いた時点の差分を初期値にして
                以後は入力欄が正なので、チェックを動かしても文が追随せず「押しても
                何も起きない」操作になる。
              */
              selection={{ selectedIds, onToggle: toggleFinding, disabled: busy || regenerating }}
            />

            {/*
              指摘から生成へ戻す線（PHASE 6.1）。
              **差分を持つ指摘が 1 件も無いときはボタンを出さない。**
              押しても足すものが無いボタンは、押せるのに何も起きない操作になる。
            */}
            {correctable.length > 0 && !regenerating && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  disabled={busy || deltas.length === 0}
                  onClick={() => {
                    setRegenerating(true)
                  }}
                >
                  選んだ指摘を直して再生成
                </Button>
                <span className="text-xs text-muted">
                  {deltas.length === 0
                    ? '足したい指摘にチェックを入れてください。'
                    : `${String(deltas.length)} 件を選んでいます。次の画面で文を直せます。`}
                </span>
              </div>
            )}

            {regenerating && (
              <RegenerateForm
                shotId={shotId}
                initialDeltas={deltas}
                disabled={busy}
                api={generateApi}
                onCancel={() => {
                  setRegenerating(false)
                }}
                onQueued={() => {
                  setRegenerating(false)
                  setSelectedIds([])
                  setFeedback({ tone: 'success', message: '直しを添えて生成を積みました。' })
                }}
              />
            )}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">

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
