'use client'

import type { Shot } from '@ixa/domain'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { WireShotDub } from '@/lib/dub-api'
import { isDubActive } from '@/lib/dub-view'

/** 差し替えを待っている・作っている間に、様子を見に行く間隔。 */
export const DUB_POLL_MS = 3_000

export type ShotDub = {
  /** null は「まだ読めていない」。 */
  readonly state: WireShotDub | null
  readonly error: string | null
  readonly busy: boolean
  readonly start: () => void
  readonly cancel: () => void
}

/**
 * Shot の声の差し替え（ADR-0062）の様子。待っている・作っている間は {@link DUB_POLL_MS} ごとに見に行き、
 * 終わったら `onSettled` を呼ぶ（採用が新しい Take に移るので、呼び出し側が Shot を読み直す）。
 */
export const useShotDub = (
  shot: Pick<Shot, 'id' | 'status' | 'selectedTakeId' | 'dialogue'>,
  epoch: number,
  onSettled: () => void,
): ShotDub => {
  const api = useMemo(() => createApiClient(), [])
  const [state, setState] = useState<WireShotDub | null>(null)
  /** 読めなかった（読めたら消す）と、押した操作が断られた（次に押すまで残す）を分けて持つ。 */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reloads, setReloads] = useState(0)
  const settledRef = useRef(onSettled)
  useEffect(() => {
    settledRef.current = onSettled
  }, [onSettled])
  const wasActive = useRef(false)

  // セリフの無い Shot は差し替えるものが無いので読みに行かない。
  const speaking = shot.dialogue.length > 0
  useEffect(() => {
    if (!speaking) return undefined
    let cancelled = false
    api
      .getShotDub(shot.id)
      .then((next) => {
        if (cancelled) return
        setState(next)
        setLoadError(null)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(`声の差し替えの様子を読めません: ${describeForPerson(cause)}`)
      })
    return () => {
      cancelled = true
    }
  }, [api, speaking, shot.id, shot.status, shot.selectedTakeId, epoch, reloads])

  const active = isDubActive(state?.latestJob ?? null)
  useEffect(() => {
    if (wasActive.current && !active) settledRef.current()
    wasActive.current = active
    if (!active) return undefined
    const timer = window.setTimeout(() => {
      setReloads((count) => count + 1)
    }, DUB_POLL_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [active, state])

  const start = useCallback((): void => {
    setBusy(true)
    setError(null)
    api
      .startDub(shot.id)
      .then((job) => {
        setState((current) => ({ blocker: current?.blocker ?? null, latestJob: job }))
      })
      .catch((cause: unknown) => {
        setError(`声を差し替えられませんでした: ${describeForPerson(cause)}`)
        setReloads((count) => count + 1)
      })
      .finally(() => {
        setBusy(false)
      })
  }, [api, shot.id])

  const jobId = state?.latestJob?.id ?? null
  const cancel = useCallback((): void => {
    if (jobId === null) return
    setBusy(true)
    api
      .cancelDubJob(jobId)
      .then((job) => {
        setState((current) => ({ blocker: current?.blocker ?? null, latestJob: job }))
      })
      .catch((cause: unknown) => {
        setError(`取り消せませんでした: ${describeForPerson(cause)}`)
      })
      .finally(() => {
        setBusy(false)
      })
  }, [api, jobId])

  return { state, error: error ?? loadError, busy, start, cancel }
}
