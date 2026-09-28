'use client'

import { SHOT_LIST_EVENT_TYPES, type ProjectEvent, type ProjectId } from '@ixa/domain'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  parseProjectEvent,
  projectEventsUrl,
  reconnectDelayMs,
  type LiveState,
} from '@/lib/project-events'

/**
 * Project の出来事を SSE で受け続けるフック（Phase 5.8b）。
 *
 * **判断はここに書かない。** 待ち時間も文面も `project-events.ts` の純粋関数が持つ。
 * ここがやるのは「繋ぐ・切る・数える」だけ。
 *
 * **最初の描画では繋がない。** サーバに `EventSource` は無く、初期状態を
 * 環境から決めるとハイドレーションが食い違う（lessons L-019）。接続は `useEffect` の中。
 *
 * **後始末を落とさないこと。** 画面を離れたら `close()` と `clearTimeout()` の両方を呼ぶ。
 * どちらかを忘れても画面は正常に見えるため、テストで呼び出しそのものを見張る（lessons L-022）。
 */

/** SSE の 1 行目に来る、購読が成立したことの合図。 */
export const READY_EVENT = 'ready'

export type UseProjectEventsOptions = {
  readonly projectId: ProjectId
  readonly baseUrl: string
  /** false の間は繋がない。既定は true。 */
  readonly enabled?: boolean
  /** 出来事が 1 件読めるたびに呼ばれる。**最新のものが呼ばれる**（張り直しは起きない）。 */
  readonly onEvent?: (event: ProjectEvent) => void
}

export type ProjectEventsStatus = {
  readonly state: LiveState
  /** 最後に受け取った出来事の時刻（ISO 8601）。まだ何も来ていなければ null。 */
  readonly lastEventAt: string | null
  /** 繋ぎ直しを試みた回数。`ready` で 0 に戻る。 */
  readonly attempt: number
  /** 読めなかった `data:` の件数。**黙って捨てた数を隠さない**（lessons L-015）。 */
  readonly invalidCount: number
}

/** `MessageEvent` の `data` を安全に取り出す。文字列でなければ読めなかった扱い。 */
const readData = (event: Event): string | null => {
  const data: unknown = (event as MessageEvent<unknown>).data
  return typeof data === 'string' ? data : null
}

export const useProjectEvents = ({
  projectId,
  baseUrl,
  enabled = true,
  onEvent,
}: UseProjectEventsOptions): ProjectEventsStatus => {
  // 初期値は props だけから決める。環境（EventSource の有無）を見ない。
  const [state, setState] = useState<LiveState>(enabled ? 'connecting' : 'stopped')
  const [lastEventAt, setLastEventAt] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [invalidCount, setInvalidCount] = useState(0)

  // 張り直しを起こさずに最新の受け口を呼ぶための控え。
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  })

  useEffect(() => {
    setLastEventAt(null)
    setAttempt(0)

    if (!enabled) {
      setState('stopped')
      return
    }
    if (typeof EventSource === 'undefined') {
      // サーバ描画や EventSource の無い環境。繋がっていないことを正直に出す。
      setState('stopped')
      return
    }

    const url = projectEventsUrl(baseUrl, projectId)
    let disposed = false
    let source: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0

    const clearTimer = (): void => {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
    }

    const handleEvent = (event: Event): void => {
      const raw = readData(event)
      const parsed = raw === null ? null : parseProjectEvent(raw)
      if (parsed === null) {
        setInvalidCount((count) => count + 1)
        return
      }
      setLastEventAt(parsed.at)
      onEventRef.current?.(parsed)
    }

    const connect = (): void => {
      if (disposed) return
      const opened = new EventSource(url)
      source = opened

      opened.addEventListener(READY_EVENT, () => {
        if (disposed) return
        failures = 0
        setAttempt(0)
        setState('live')
      })

      for (const type of SHOT_LIST_EVENT_TYPES) {
        opened.addEventListener(type, handleEvent)
      }

      opened.addEventListener('error', () => {
        // 自前でバックオフするので、ブラウザ既定の再接続は止める。
        opened.close()
        if (disposed) return
        failures += 1
        setAttempt(failures)
        setState('reconnecting')
        clearTimer()
        // `Last-Event-ID` はブラウザが `id:` を覚えて自動で送る。自前で付けない。
        timer = setTimeout(connect, reconnectDelayMs(failures))
      })
    }

    connect()

    return () => {
      disposed = true
      clearTimer()
      source?.close()
    }
  }, [projectId, baseUrl, enabled])

  // 同じ値なら同じ物を返す。受け手（ワークベンチの共有値）が毎回描き直さないように。
  return useMemo(
    () => ({ state, lastEventAt, attempt, invalidCount }),
    [state, lastEventAt, attempt, invalidCount],
  )
}
