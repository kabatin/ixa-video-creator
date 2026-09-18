'use client'

import type { Shot, Take } from '@ixa/domain'
import { useCallback, useEffect, useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'

export type ShotTakes = {
  /** null は「まだ読めていない」。0 本の Shot とは別物（L-021）。 */
  readonly takes: readonly Take[] | null
  readonly error: string | null
  readonly reload: () => void
  /** 判定の保存など、1 本だけ差し替える。 */
  readonly replaceTake: (take: Take) => void
}

/**
 * 選択中の Shot の Take（Take 比較・インスペクターが使う）。
 *
 * **Shot の状態か採用 Take が変わったら取り直す。** 生成の完了は SSE で Shot の状態に
 * 届くので、ここはそれを見て追う（旧 Shot 詳細のポーリングの代わり）。
 */
export const useShotTakes = (shot: Shot | null, epoch: number): ShotTakes => {
  const [takes, setTakes] = useState<readonly Take[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  const shotId = shot?.id ?? null
  const status = shot?.status ?? null
  const selectedTakeId = shot?.selectedTakeId ?? null

  useEffect(() => {
    if (shotId === null) {
      setTakes(null)
      return undefined
    }
    let cancelled = false
    setError(null)
    createApiClient()
      .listTakes(shotId)
      .then((next) => {
        if (!cancelled) setTakes(next)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setTakes(null)
        setError(`Take を取得できませんでした: ${describeError(cause)}`)
      })
    return () => {
      cancelled = true
    }
  }, [shotId, status, selectedTakeId, epoch, reloads])

  const reload = useCallback(() => {
    setReloads((count) => count + 1)
  }, [])

  const replaceTake = useCallback((take: Take) => {
    setTakes((current) =>
      current === null ? current : current.map((entry) => (entry.id === take.id ? take : entry)),
    )
  }, [])

  return { takes, error, reload, replaceTake }
}
