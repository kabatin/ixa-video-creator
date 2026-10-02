'use client'

import type { ProjectId } from '@ixa/domain'
import { useEffect, useState } from 'react'
import type { GenerationActivityApi, WireActiveGeneration } from '@/lib/generation-activity-api'

/** 聞き直す間隔。経過の表示は毎秒刻むので、ここは状態（順番待ち→作成中）の変化に追いつけば足りる。 */
const POLL_INTERVAL_MS = 5_000

/** Shot ごとの動いている生成。作成中を先に、同じ状態なら頼んだ順。 */
export type ActiveGenerations = ReadonlyMap<string, readonly WireActiveGeneration[]>

const EMPTY: ActiveGenerations = new Map()

const groupByShot = (entries: readonly WireActiveGeneration[]): ActiveGenerations => {
  const rank = (generation: WireActiveGeneration): number =>
    generation.status === 'running' ? 0 : 1
  return entries.reduce<Map<string, readonly WireActiveGeneration[]>>((map, generation) => {
    const next = [...(map.get(generation.shotId) ?? []), generation].sort(
      (a, b) => rank(a) - rank(b),
    )
    return new Map(map).set(generation.shotId, next)
  }, new Map())
}

/**
 * 動いている生成を追う（制作者 2026-09-30「生成中です、と出ているだけでわかりづらい」）。
 * **生成中の Shot があるあいだだけ** 5 秒おきに聞く。読めなかったときは前の値を残す
 * （表示が「生成中」に戻るだけで、作業は止めない）。
 */
export const useActiveGenerations = (
  api: Pick<GenerationActivityApi, 'listActiveGenerations'>,
  projectId: ProjectId,
  anyGenerating: boolean,
): ActiveGenerations => {
  const [generations, setGenerations] = useState<ActiveGenerations>(EMPTY)

  useEffect(() => {
    if (!anyGenerating) {
      setGenerations(EMPTY)
      return undefined
    }
    let alive = true
    const load = (): void => {
      api
        .listActiveGenerations(projectId)
        .then((entries) => {
          if (alive) setGenerations(groupByShot(entries))
        })
        .catch(() => {
          // 前の値を残す。経過が出ないだけで、生成そのものは Shot の状態で追えている。
        })
    }
    load()
    const timer = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [api, projectId, anyGenerating])

  return generations
}

/** 経過の表示を刻む今の時刻。`enabled` のあいだだけ 1 秒ごとに進む。 */
export const useNow = (enabled: boolean): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return undefined
    setNow(Date.now())
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1_000)
    return () => {
      clearInterval(timer)
    }
  }, [enabled])
  return now
}
