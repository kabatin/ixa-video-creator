'use client'

import type { MusicTrack } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { formatClock } from '@/lib/format-time'
import { POLL_TIMEOUT_MS, startAsyncPolling, type PollHandle } from '@/lib/poller'
import { ProgressDialog } from '@/components/ui/progress-dialog'
import { WORDING } from '@/lib/wording'

/**
 * 未解析の楽曲について、音楽解析をキューへ積む操作。
 *
 * 解析は worker が数十秒かけて行う。以前は積んだあと放置で、
 * 利用者が「結果を確認」を押すまで終わったかどうか分からなかった。
 * いまは積んだ直後から結果を追いかけ、**終わったら自動で画面を差し替える。**
 *
 * 状態は 5 つを混ぜない。まだ始めていない / 送信中 / 待っている / 終わった /
 * 上限まで待った / 失敗した。特に「上限まで待った」を「終わった」にしない（lessons L-015）。
 *
 * **解析は自分から始める。** 解析されていない曲では何もできないので、押させる意味が無い。
 * 以前は曲を入れた直後に解析が走っているのに、画面は「まだ解析されていません・解析を実行」
 * のままで、すでに動いているものをもう一度押させる形になっていた（実測）。
 * 終わるまでは進捗ダイアログで手を止める。**押したのに何も起きないように見える**のを無くす。
 *
 * API に「解析が走っているか」を問う口が無く、`getAnalysis` は結果が出るまで null しか
 * 返さないため、画面を開き直したときは始まっているかどうか分からない。分からないので
 * もう一度頼む。解析は結果を上書きするだけで、二重に頼んでも壊れない（局所・無料）。
 */

export type AnalysisStarterProps = {
  readonly track: MusicTrack
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'waiting'; readonly startedAtMs: number; readonly elapsedMs: number }
  | { readonly kind: 'done' }
  /** 上限まで待っても結果が出なかった。終わっていない可能性が高い。 */
  | { readonly kind: 'timeout' }
  | { readonly kind: 'failed'; readonly message: string }

const IDLE: Phase = { kind: 'idle' }

const timeoutMinutes = (): string => String(Math.round(POLL_TIMEOUT_MS / 60_000))

export const AnalysisStarter = ({ track }: AnalysisStarterProps) => {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>(IDLE)
  const pollRef = useRef<PollHandle | null>(null)

  // 毎レンダーで作り直すと base URL の解決が繰り返される。1 度だけ組む。
  const api = useMemo(() => createApiClient(), [])

  // 画面を離れたらポーリングを止める。止め忘れはリクエストの垂れ流しになる。
  useEffect(
    () => () => {
      pollRef.current?.stop()
    },
    [],
  )

  const watch = (startedAtMs: number): void => {
    pollRef.current?.stop()
    setPhase({ kind: 'waiting', startedAtMs, elapsedMs: 0 })
    pollRef.current = startAsyncPolling({
      probe: async () => {
        const analysis = await api.getAnalysis(track.id)
        return { running: analysis === null, value: analysis }
      },
      onProbe: () => {
        setPhase((current) =>
          current.kind === 'waiting'
            ? { ...current, elapsedMs: Date.now() - current.startedAtMs }
            : current,
        )
      },
      onSettled: () => {
        setPhase({ kind: 'done' })
        // 解析結果が要るのはサーバ側で組み立てる画面なので、取り直させる。
        router.refresh()
      },
      onTimeout: () => {
        setPhase({ kind: 'timeout' })
      },
      onFailed: (caught) => {
        setPhase({ kind: 'failed', message: describeError(caught) })
      },
    })
  }

  const start = async (): Promise<void> => {
    setPhase({ kind: 'sending' })
    try {
      await api.requestAnalysis(track.id)
    } catch (caught) {
      setPhase({ kind: 'failed', message: describeError(caught) })
      return
    }
    watch(Date.now())
  }

  const busy = phase.kind === 'sending' || phase.kind === 'waiting'

  /**
   * 取り付いたら自分で始める。**1 曲につき 1 回だけ。**
   * 失敗したあとに勝手に繰り返すと、同じ失敗を延々と積むことになる。
   */
  const startedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (startedForRef.current === track.id) return
    startedForRef.current = track.id
    void start()
    // start は track だけに依存する。依存に入れると毎描画で作り直されて何度も走る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id])

  return (
    <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
      <ProgressDialog
        open={busy}
        title="曲を解析しています"
        message={
          phase.kind === 'sending'
            ? '解析を頼んでいます。'
            : '拍と小節頭を数えています。終わったらそのまま切る画面になります。'
        }
        // 進み具合は返ってこない。作らない。
        value={null}
      >
        {phase.kind === 'waiting' && (
          <p className="text-xs text-muted">{`経過 ${formatClock(phase.elapsedMs / 1_000)}`}</p>
        )}
      </ProgressDialog>

      <h2 className="text-base font-semibold text-text">この楽曲はまだ解析されていません</h2>
      <p className="mt-1 text-sm text-muted">
        Shot を割るにはビートとセクションが必要です。解析が終わるまで待ってください。
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          tone="primary"
          disabled={busy}
          onClick={() => {
            void start()
          }}
        >
          {phase.kind === 'sending' ? '送信中…' : `解析をもう一度${WORDING.start}`}
        </Button>

        {(phase.kind === 'timeout' || phase.kind === 'failed') && (
          <Button
            onClick={() => {
              router.refresh()
            }}
          >
            {WORDING.refresh}
          </Button>
        )}
      </div>

      <div className="mt-3">
        {phase.kind === 'waiting' && (
          <p role="status" className="text-sm text-text">
            {`解析を受け付けました。完了を待っています（経過 ${formatClock(phase.elapsedMs / 1_000)}）。終わったら自動で切り替わります。`}
          </p>
        )}

        {phase.kind === 'done' && (
          <p role="status" className="text-sm text-ok">
            解析が終わりました。画面を切り替えています。
          </p>
        )}

        {phase.kind === 'timeout' && (
          <p role="alert" className="text-sm text-warn">
            {`${timeoutMinutes()} 分待ちましたが結果が出ませんでした。追いかけるのをやめます。解析はまだ続いているかもしれません。画面を開き直すと今の状態が分かります。それでも変わらなければ、もう一度解析を始めてください。`}
          </p>
        )}

        {phase.kind === 'failed' && (
          <p role="alert" className="text-sm text-danger">
            {phase.message}
          </p>
        )}
      </div>
    </div>
  )
}
