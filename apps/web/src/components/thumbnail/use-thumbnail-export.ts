'use client'

import type { ProjectId, ThumbnailId, ThumbnailSpec } from '@ixa/domain'
import { useCallback, useEffect, useRef, useState } from 'react'
import { describeForPerson } from '@/lib/api-error'
import { startAsyncPolling, type PollHandle } from '@/lib/poller'
import { isThumbnailSettled, type ThumbnailApi, type WireThumbnail } from '@/lib/thumbnail-api'

/**
 * サムネイルの書き出しを頼んで、終わるまで追う（ADR-0051）。これまでの書き出しの一覧もここが持つ。
 * 1 枚は数秒で終わるので、ダイアログの中だけで追う（閉じたら追わない。一覧は開き直せば読める）。
 */

/** 1 枚は数秒。描く順番待ちがあっても収まる長さ。 */
const EXPORT_TIMEOUT_MS = 3 * 60 * 1_000
const EXPORT_POLL_INTERVAL_MS = 1_500

export type ThumbnailExport = {
  /** null は「読めていない」。 */
  readonly list: readonly WireThumbnail[] | null
  readonly listError: string | null
  /** いま追っている書き出し。 */
  readonly current: WireThumbnail | null
  readonly submitting: boolean
  readonly problem: string | null
  readonly start: (spec: ThumbnailSpec) => void
}

/** 一覧の中の 1 件を差し替える（無ければ先頭へ足す。新しい順）。 */
const upsert = (list: readonly WireThumbnail[] | null, item: WireThumbnail): readonly WireThumbnail[] => {
  const rest = (list ?? []).filter((entry) => entry.id !== item.id)
  return [item, ...rest].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

export const useThumbnailExport = (projectId: ProjectId, api: ThumbnailApi): ThumbnailExport => {
  const [list, setList] = useState<readonly WireThumbnail[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [current, setCurrent] = useState<WireThumbnail | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const poll = useRef<PollHandle | null>(null)

  useEffect(() => {
    let alive = true
    api
      .listThumbnails(projectId)
      .then((found) => {
        if (alive) setList(found)
      })
      .catch((cause: unknown) => {
        if (alive) setListError(`これまでの書き出しを読めませんでした: ${describeForPerson(cause)}`)
      })
    return () => {
      alive = false
      poll.current?.stop()
    }
  }, [api, projectId])

  const follow = useCallback(
    (id: ThumbnailId) => {
      poll.current?.stop()
      poll.current = startAsyncPolling({
        probe: async () => {
          const found = await api.getThumbnail(id)
          return { running: !isThumbnailSettled(found), value: found }
        },
        onProbe: ({ value }) => {
          setCurrent(value)
          setList((before) => upsert(before, value))
        },
        onTimeout: () => setProblem('時間がかかっています。しばらくしてから開き直してください。'),
        onFailed: (cause) => setProblem(`書き出しの様子を読めませんでした: ${describeForPerson(cause)}`),
        intervalMs: EXPORT_POLL_INTERVAL_MS,
        timeoutMs: EXPORT_TIMEOUT_MS,
      })
    },
    [api],
  )

  const start = useCallback(
    (spec: ThumbnailSpec) => {
      setSubmitting(true)
      setProblem(null)
      setCurrent(null)
      api
        .startThumbnail(projectId, spec)
        .then(async (id) => {
          const first = await api.getThumbnail(id)
          setCurrent(first)
          setList((before) => upsert(before, first))
          if (!isThumbnailSettled(first)) follow(id)
        })
        .catch((cause: unknown) => {
          setProblem(`書き出せませんでした: ${describeForPerson(cause)}`)
        })
        .finally(() => {
          setSubmitting(false)
        })
    },
    [api, follow, projectId],
  )

  return { list, listError, current, submitting, problem, start }
}
