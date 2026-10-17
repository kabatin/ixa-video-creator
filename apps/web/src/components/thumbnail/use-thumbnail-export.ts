'use client'

import type { ProjectId, ThumbnailId, ThumbnailSpec } from '@ixa/domain'
import { useCallback, useEffect, useRef, useState } from 'react'
import { describeForPerson } from '@/lib/api-error'
import { startAsyncPolling, type PollHandle } from '@/lib/poller'
import { isThumbnailSettled, type ThumbnailApi, type WireThumbnail } from '@/lib/thumbnail-api'

/**
 * サムネイルの書き出しを頼んで、終わるまで追う（ADR-0051）。これまでの書き出しの一覧もここが持つ。
 * 1 枚は数秒で終わるので、ダイアログの中だけで追う（閉じたら追わない。一覧は開き直せば読める）。
 *
 * **追いかけているかどうかを状態で持つ。** 「いまの 1 枚が待ち・描いている」で押せなくすると、
 * 追うのを諦めた（時間切れ）あとも押せないままになる。諦めたら押せるように戻し、待っていることを言う。
 */

/** 1 枚は数秒。描く順番待ちがあっても収まる長さ。 */
export const EXPORT_TIMEOUT_MS = 3 * 60 * 1_000
const EXPORT_POLL_INTERVAL_MS = 1_500
/** 追うのを諦めたあと、一覧をもう一度読むまでの間（終わっていれば一覧に出る）。 */
export const LIST_REFRESH_AFTER_TIMEOUT_MS = 30_000

export const STILL_WAITING_MESSAGE = 'まだ順番を待っています。終わったら下の一覧に出ます。'

export type ThumbnailExport = {
  /** null は「読めていない」。 */
  readonly list: readonly WireThumbnail[] | null
  readonly listError: string | null
  /** いま追っている（または最後に追った）書き出し。 */
  readonly current: WireThumbnail | null
  /** 頼んでいる最中か、終わるまで追いかけている最中。この間は次を頼めない。 */
  readonly busy: boolean
  readonly problem: string | null
  /** 失敗ではない知らせ（まだ待っている、など）。 */
  readonly note: string | null
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
  const [following, setFollowing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const poll = useRef<PollHandle | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 閉じた（unmount した）あとに返ってきた応答で、追いかけを始めない・状態を書かない。 */
  const mounted = useRef(true)

  const loadList = useCallback(() => {
    api
      .listThumbnails(projectId)
      .then((found) => {
        if (mounted.current) setList(found)
      })
      .catch((cause: unknown) => {
        if (mounted.current) setListError(`これまでの書き出しを読めませんでした: ${describeForPerson(cause)}`)
      })
  }, [api, projectId])

  useEffect(() => {
    mounted.current = true
    loadList()
    return () => {
      mounted.current = false
      poll.current?.stop()
      poll.current = null
      if (refreshTimer.current !== null) clearTimeout(refreshTimer.current)
    }
  }, [loadList])

  const follow = useCallback(
    (id: ThumbnailId) => {
      poll.current?.stop()
      setFollowing(true)
      poll.current = startAsyncPolling({
        probe: async () => {
          const found = await api.getThumbnail(id)
          return { running: !isThumbnailSettled(found), value: found }
        },
        onProbe: ({ value }) => {
          setCurrent(value)
          setList((before) => upsert(before, value))
        },
        onSettled: () => setFollowing(false),
        onTimeout: () => {
          // 諦めても次は頼めるようにする。終わったかは分からないので、少し後に一覧を読み直す。
          setFollowing(false)
          setNote(STILL_WAITING_MESSAGE)
          refreshTimer.current = setTimeout(loadList, LIST_REFRESH_AFTER_TIMEOUT_MS)
        },
        onFailed: (cause) => {
          setFollowing(false)
          setProblem(`書き出しの様子を読めませんでした: ${describeForPerson(cause)}`)
        },
        intervalMs: EXPORT_POLL_INTERVAL_MS,
        timeoutMs: EXPORT_TIMEOUT_MS,
      })
    },
    [api, loadList],
  )

  const start = useCallback(
    (spec: ThumbnailSpec) => {
      setSubmitting(true)
      setProblem(null)
      setNote(null)
      setCurrent(null)
      api
        .startThumbnail(projectId, spec)
        .then(async (id) => {
          const first = await api.getThumbnail(id)
          if (!mounted.current) return
          setCurrent(first)
          setList((before) => upsert(before, first))
          if (!isThumbnailSettled(first)) follow(id)
        })
        .catch((cause: unknown) => {
          if (mounted.current) setProblem(`書き出せませんでした: ${describeForPerson(cause)}`)
        })
        .finally(() => {
          if (mounted.current) setSubmitting(false)
        })
    },
    [api, follow, projectId],
  )

  return { list, listError, current, busy: submitting || following, problem, note, start }
}
