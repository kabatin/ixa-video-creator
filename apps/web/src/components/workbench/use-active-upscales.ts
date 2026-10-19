'use client'

import type { ProjectId } from '@ixa/domain'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UpscaleActivityApi, WireActiveUpscale } from '@/lib/upscale-activity-api'

/** 聞き直す間隔。経過の表示は毎秒刻むので、ここは状態（待ち→作成中・終わった）の変化に追いつけば足りる。 */
const POLL_INTERVAL_MS = 5_000

/** Shot ごとの動いている超解像。作成中を先に、同じ状態なら頼んだ順。 */
export type ActiveUpscales = ReadonlyMap<string, readonly WireActiveUpscale[]>

const EMPTY: ActiveUpscales = new Map()

const groupByShot = (entries: readonly WireActiveUpscale[]): ActiveUpscales => {
  const rank = (upscale: WireActiveUpscale): number => (upscale.status === 'running' ? 0 : 1)
  return entries.reduce<Map<string, readonly WireActiveUpscale[]>>((map, upscale) => {
    const next = [...(map.get(upscale.shotId) ?? []), upscale].sort((a, b) => rank(a) - rank(b))
    return new Map(map).set(upscale.shotId, next)
  }, new Map())
}

const jobIdsOf = (upscales: ActiveUpscales): ReadonlySet<string> =>
  new Set([...upscales.values()].flat().map((upscale) => upscale.jobId))

/**
 * 動いている超解像を追う（制作者 2026-10-19「Shot 一覧で、超解像の待ち・作成中の Shot がわかるように」）。
 * 超解像は Shot の状態を変えないので、**開いたときと `epoch` が進んだとき**（超解像の出来事）に聞き、
 * **ジョブがあるあいだだけ** 5 秒おきに聞き直す。前にあったジョブが消えたら `onFinished`（Take を読み直す）。
 * 読めなかったときは前の値を残す（印が出ないだけで、超解像そのものは止めない）。
 */
export const useActiveUpscales = (
  api: Pick<UpscaleActivityApi, 'listActiveUpscales'>,
  projectId: ProjectId,
  epoch: number,
  onFinished: () => void,
): ActiveUpscales => {
  const [upscales, setUpscales] = useState<ActiveUpscales>(EMPTY)
  const [polling, setPolling] = useState(false)
  const known = useRef<ReadonlySet<string>>(new Set())
  const finished = useRef(onFinished)
  finished.current = onFinished
  /** 外したあと（作品を替えた・閉じた）に届いた答えを当てない。 */
  const generation = useRef(0)

  const load = useCallback((): void => {
    const asked = generation.current
    api
      .listActiveUpscales(projectId)
      .then((entries) => {
        if (asked !== generation.current) return
        const next = groupByShot(entries)
        const ids = jobIdsOf(next)
        const ended = [...known.current].some((id) => !ids.has(id))
        known.current = ids
        setUpscales(next)
        setPolling(ids.size > 0)
        if (ended) finished.current()
      })
      .catch(() => {
        // 前の値を残す。経過が出ないだけで、超解像そのものは worker が進めている。
      })
  }, [api, projectId])

  // 開いたとき・超解像の出来事が来たときに 1 回聞く。
  useEffect(() => {
    load()
  }, [load, epoch])

  // ジョブがあるあいだだけ聞き直す。
  useEffect(() => {
    if (!polling) return undefined
    const timer = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [load, polling])

  useEffect(
    () => () => {
      generation.current += 1
    },
    [load],
  )

  return upscales
}
