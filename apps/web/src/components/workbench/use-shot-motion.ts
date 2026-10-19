'use client'

import type { ShotId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { isMotionSettled, type WireShotMotion } from '@/lib/motion-api'

/** 分析を待つ間の読み直しの間隔（ミリ秒）。Claude の判定は 1 回に数十秒かかる。 */
const POLL_MS = 3000

export type ShotMotionLoad =
  | { readonly state: 'loading' }
  | { readonly state: 'error'; readonly message: string }
  | { readonly state: 'ready'; readonly motion: WireShotMotion }

/**
 * Shot の動きの分析を読む（ADR-0054）。**まだ分析していなければ、開いたときに頼む**（採用中の Take があるとき）。
 * 待っている・分析している間は読み直し続け、終わったら止める。
 */
export const useShotMotion = (shotId: ShotId | null): ShotMotionLoad => {
  const client = useMemo(() => createApiClient(), [])
  const [load, setLoad] = useState<ShotMotionLoad>({ state: 'loading' })

  useEffect(() => {
    if (shotId === null) return undefined
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    let asked = false
    setLoad({ state: 'loading' })

    const tick = async (): Promise<void> => {
      try {
        const motion = await client.getShotMotion(shotId)
        if (!alive) return
        if (motion.state === 'none' && motion.takeId !== null && !asked) {
          asked = true
          await client.analyzeShotMotion(shotId)
          if (alive) timer = setTimeout(() => void tick(), 0)
          return
        }
        setLoad({ state: 'ready', motion })
        if (!isMotionSettled(motion.state) && motion.state !== 'none') timer = setTimeout(() => void tick(), POLL_MS)
      } catch (cause) {
        if (alive) setLoad({ state: 'error', message: `動きの分析を読めませんでした: ${describeForPerson(cause)}` })
      }
    }
    void tick()
    return () => {
      alive = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [client, shotId])

  return load
}
