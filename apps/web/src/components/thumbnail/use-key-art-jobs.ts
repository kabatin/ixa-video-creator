'use client'

import type { ImageGenerationJobId, ProjectId } from '@ixa/domain'
import { useCallback, useEffect, useRef, useState } from 'react'
import { describeForPerson } from '@/lib/api-error'
import { startAsyncPolling, type PollHandle } from '@/lib/poller'
import { isKeyArtActive, type ThumbnailApi, type WireKeyArtJob } from '@/lib/thumbnail-api'

/**
 * 背景を AI に描かせる（キーアート。ADR-0051）ジョブの追いかけ。
 *
 * **ダイアログの側で持つ。** 背景の選び方（タブ）の中に置くと、タブを替えた瞬間に追いかけが消え、
 * 戻ると「描かせる」がまた押せて、同じ絵を 2 度頼めてしまう。描いている間は頼めない。
 */

/** 1 枚 1〜2 分。数枚頼んでも収まるように長めに待つ。 */
const KEY_ART_TIMEOUT_MS = 15 * 60 * 1_000

export type KeyArtJobs = {
  readonly jobs: readonly WireKeyArtJob[]
  /** いま頼んだ分の ID。 */
  readonly requested: readonly ImageGenerationJobId[]
  /** 頼んだ分のうち、まだ描いている枚数。 */
  readonly drawing: number
  readonly submitting: boolean
  /** 頼めるか（送っている最中・描いている最中は頼めない）。 */
  readonly canGenerate: boolean
  readonly note: string | null
  readonly generate: (input: { readonly count: number; readonly instruction: string }) => Promise<void>
}

export const useKeyArtJobs = (projectId: ProjectId, api: ThumbnailApi): KeyArtJobs => {
  const [jobs, setJobs] = useState<readonly WireKeyArtJob[]>([])
  const [requested, setRequested] = useState<readonly ImageGenerationJobId[]>([])
  const [submitting, setSubmitting] = useState(false)
  /** 頼んだ分を追いかけている最中か（終わる・諦める・読めなくなるまで）。 */
  const [following, setFollowing] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const poll = useRef<PollHandle | null>(null)
  const mounted = useRef(true)
  /** 同じ描画のうちに 2 度押されても 2 度頼まない（state は次の描画まで変わらない）。 */
  const busy = useRef(false)
  const release = useCallback((): void => {
    busy.current = false
    setFollowing(false)
  }, [])

  useEffect(() => {
    mounted.current = true
    api
      .listKeyArt(projectId)
      .then((found) => {
        if (mounted.current) setJobs(found)
      })
      .catch((cause: unknown) => {
        if (mounted.current) setNote(`前に描かせた絵を読めませんでした: ${describeForPerson(cause)}`)
      })
    return () => {
      mounted.current = false
      poll.current?.stop()
      poll.current = null
    }
  }, [api, projectId])

  const follow = useCallback(
    (jobIds: readonly ImageGenerationJobId[]) => {
      poll.current?.stop()
      setFollowing(true)
      poll.current = startAsyncPolling({
        probe: async () => {
          const found = await api.listKeyArt(projectId)
          return { running: found.some((job) => jobIds.includes(job.id) && isKeyArtActive(job)), value: found }
        },
        onProbe: ({ value }) => setJobs(value),
        onSettled: release,
        onTimeout: () => {
          release()
          setNote('時間がかかっています。しばらくしてから開き直してください。')
        },
        onFailed: (cause) => {
          release()
          setNote(`描いている絵の様子を読めませんでした: ${describeForPerson(cause)}`)
        },
        timeoutMs: KEY_ART_TIMEOUT_MS,
      })
    },
    [api, projectId, release],
  )

  const drawing = jobs.filter((job) => requested.includes(job.id) && isKeyArtActive(job)).length
  // 頼んだ直後で一覧にまだ載っていない間も、追いかけている限り押し直せない。
  const canGenerate = !submitting && !following

  const generate = useCallback(
    async (input: { readonly count: number; readonly instruction: string }): Promise<void> => {
      if (busy.current) return
      busy.current = true
      setSubmitting(true)
      setNote(null)
      try {
        const jobIds = await api.generateKeyArt(projectId, input)
        if (!mounted.current) return
        setRequested(jobIds)
        follow(jobIds)
      } catch (cause) {
        busy.current = false
        if (mounted.current) setNote(`頼めませんでした: ${describeForPerson(cause)}`)
      } finally {
        if (mounted.current) setSubmitting(false)
      }
    },
    [api, follow, projectId],
  )

  return { jobs, requested, drawing, submitting, canGenerate, note, generate }
}
