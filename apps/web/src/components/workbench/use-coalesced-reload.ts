'use client'

import { useCallback, useEffect, useRef } from 'react'

export type CoalesceTiming = {
  /** 合図が止んでからこれだけ待って読み直す。 */
  readonly quietMs: number
  /** 合図が途切れなくても、最初の合図からこれだけ経てば読み直す（99 件の書き込みの間ずっと古いままにしない）。 */
  readonly maxWaitMs: number
}

/**
 * 続けて来る合図を、読み直し 1 回にまとめる（2026-10-30）。
 *
 * MCP の `edit_clips` は 1 件ずつ書くので、99 件のテロップを直すと `project.edited` が 99 回届く。
 * 1 回ごとに読み直すと、サーバの描き直しとタイムラインの取り直しが 99 回走る。
 */
export const useCoalescedReload = (reload: () => void, timing: CoalesceTiming): (() => void) => {
  const reloadRef = useRef(reload)
  useEffect(() => {
    reloadRef.current = reload
  }, [reload])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstAt = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )
  const { quietMs, maxWaitMs } = timing
  return useCallback((): void => {
    const now = Date.now()
    const first = firstAt.current ?? now
    firstAt.current = first
    if (timer.current !== null) clearTimeout(timer.current)
    const delay = Math.max(0, Math.min(quietMs, first + maxWaitMs - now))
    timer.current = setTimeout(() => {
      timer.current = null
      firstAt.current = null
      reloadRef.current()
    }, delay)
  }, [quietMs, maxWaitMs])
}
