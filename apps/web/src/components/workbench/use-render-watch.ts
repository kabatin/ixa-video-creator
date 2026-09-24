'use client'

import type { ProjectId, RenderJobId } from '@ixa/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { startAsyncPolling } from '@/lib/poller'
import { createRenderApi, type RenderApi, type WireRenderJob } from '@/lib/render-api'
import { activeRenderJobs } from '@/lib/render-display'
import { createRequester } from '@/lib/requester'

/**
 * 走っている書き出しの見守り（F2）。
 *
 * **ダイアログの中に置かない。** 以前は書き出しの追跡が `RenderDialogBody` の中にあり、
 * ダイアログを閉じると部品ごと unmount されてポーリングが止まった。上限を 30 分に
 * 設定してある＝それだけ長い処理だと分かっているのに、閉じた瞬間に
 * 「いま書き出している」がどこにも残らなくなっていた。
 *
 * ここは**状態を返すだけ**で、何も描かない。ワークベンチの上の方（ダイアログより
 * 長生きする場所）で 1 回呼び、必要な画面へ配る。
 *
 * 止まる理由は分けて持つ。終わった / 上限まで待った / 引き直せなくなった。
 * まとめて「終わり」にすると、終わっていないものを終わったと見せる（lessons L-015）。
 * 判断は `lib/poller.ts` が持つ。ここで数え直さない。
 */

/** 数分かかる処理なので、1 秒ごとに叩かない。 */
export const RENDER_POLL_INTERVAL_MS = 5_000

/** 4K は長い。既定の 5 分では足りないので延ばす。超えたら止めて理由を出す。 */
export const RENDER_POLL_TIMEOUT_MS = 30 * 60 * 1_000

/** 自動更新が止まった理由。**「終わった」と混ぜない。** */
export type RenderWatchNote = 'timeout' | 'failed'

export type RenderWatch = {
  /** **null は「読めていない」。** 0 件と混ぜない（lessons L-015）。 */
  readonly jobs: readonly WireRenderJob[] | null
  /** まだ動いている書き出し。ダイアログを閉じてもここに残る。 */
  readonly active: readonly WireRenderJob[]
  readonly error: string | null
  readonly note: RenderWatchNote | null
  /** 画面が持っている「いま」。経過時間はこれを使って外で計算する。未確定なら null。 */
  readonly nowMs: number | null
  /** 諦めるまでの時間。文面に書き写させないため外へ出す（lessons L-016）。 */
  readonly timeoutMs: number
  readonly refresh: () => Promise<void>
  /** いま追いかけている 1 件。投入したジョブを一覧の中で見失わないために使う。 */
  readonly watchedJobId: RenderJobId | null
  readonly watchJob: (jobId: RenderJobId) => void
}

export type UseRenderWatchOptions = {
  readonly projectId: ProjectId
  /** サーバや呼び出し元で先に読めていれば渡す。**null は「読めていない」。** */
  readonly initialJobs?: readonly WireRenderJob[] | null
  /** 読めなかった理由。あれば自分では取りに行かない。 */
  readonly initialError?: string | null
  /** テストから差し替えるための注入口。 */
  readonly api?: RenderApi
  readonly intervalMs?: number
  readonly timeoutMs?: number
}

export const useRenderWatch = ({
  projectId,
  initialJobs = null,
  initialError = null,
  api,
  intervalMs = RENDER_POLL_INTERVAL_MS,
  timeoutMs = RENDER_POLL_TIMEOUT_MS,
}: UseRenderWatchOptions): RenderWatch => {
  const client = useMemo<RenderApi>(
    () => api ?? createRenderApi(createRequester(resolveApiBaseUrl())),
    [api],
  )

  const [jobs, setJobs] = useState<readonly WireRenderJob[] | null>(initialJobs)
  const [error, setError] = useState<string | null>(initialError)
  const [note, setNote] = useState<RenderWatchNote | null>(null)
  // 最初の描画ではサーバとブラウザで値が変わるため「いま」を持たない。
  const [nowMs, setNowMs] = useState<number | null>(null)
  const [watchedJobId, setWatchedJobId] = useState<RenderJobId | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await client.listRenderJobs(projectId)
      setJobs(next)
      setError(null)
      setNowMs(Date.now())
    } catch (caught) {
      // 一覧を空に畳まない。読めていないことを残す（lessons L-015）。
      setError(describeForPerson(caught))
    }
  }, [client, projectId])

  useEffect(() => {
    setNowMs(Date.now())
  }, [])

  /** 手元に一覧が無ければ自分で取りに行く。ダイアログの外から使うときはここが入口。 */
  useEffect(() => {
    if (initialJobs !== null || initialError !== null) return
    void refresh()
  }, [refresh, initialJobs, initialError])

  const active = useMemo(() => activeRenderJobs(jobs ?? []), [jobs])
  const hasActive = active.length > 0

  /**
   * 動いているジョブがある間だけ引き直す。終わったら自分で止まる。
   * 止まった理由は分けて出す。まとめて「終わり」にすると、
   * 諦めただけのものを完了だと見せてしまう（lessons L-015）。
   */
  useEffect(() => {
    if (!hasActive) return undefined
    setNote(null)
    const handle = startAsyncPolling<readonly WireRenderJob[]>({
      intervalMs,
      timeoutMs,
      probe: async () => {
        const next = await client.listRenderJobs(projectId)
        return { running: activeRenderJobs(next).length > 0, value: next }
      },
      onProbe: ({ value }) => {
        setJobs(value)
        setError(null)
        setNowMs(Date.now())
      },
      onTimeout: () => {
        setNote('timeout')
      },
      onFailed: (caught) => {
        setError(describeForPerson(caught))
        setNote('failed')
      },
    })
    return () => {
      handle.stop()
    }
  }, [hasActive, client, projectId, intervalMs, timeoutMs])

  const watchJob = useCallback((jobId: RenderJobId): void => {
    setWatchedJobId(jobId)
  }, [])

  return { jobs, active, error, note, nowMs, timeoutMs, refresh, watchedJobId, watchJob }
}
