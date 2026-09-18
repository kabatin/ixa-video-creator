'use client'

import { useEffect, useState } from 'react'
import {
  describeLiveState,
  formatElapsedSince,
  type LiveState,
  type LiveTone,
} from '@/lib/project-events'

/**
 * 自動更新が生きているかを出す小さな印（Phase 5.8b）。
 *
 * **「繋がっていない」を静かにしないこと。** 繋がっていない間の一覧は、開いた時点の
 * 写真でしかない。何も出さないと、利用者はそれを最新だと信じる（lessons L-015）。
 * そのため `reconnecting` / `stopped` は `role="alert"` で読み上げる。
 *
 * 経過時間は**最初の描画では出さない**。`Date.now()` はサーバとブラウザで違う値になり、
 * ハイドレーションが食い違う（lessons L-019）。描画のあとに時計を回して出す。
 */

const TONE_CLASSES: Readonly<Record<LiveTone, string>> = {
  waiting: 'bg-slate-100 text-slate-700 ring-slate-200',
  live: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  stale: 'bg-amber-100 text-amber-900 ring-amber-300',
}

const DOT_CLASSES: Readonly<Record<LiveTone, string>> = {
  waiting: 'bg-slate-400',
  live: 'bg-emerald-500',
  stale: 'bg-amber-500',
}

/** 経過時間を書き換える間隔。秒を出しているので 1 秒。 */
const TICK_MS = 1_000

export type LiveStatusBadgeProps = {
  readonly state: LiveState
  readonly lastEventAt: string | null
  readonly attempt: number
}

export const LiveStatusBadge = ({ state, lastEventAt, attempt }: LiveStatusBadgeProps) => {
  const [nowMs, setNowMs] = useState<number | null>(null)

  useEffect(() => {
    const tick = (): void => {
      setNowMs(Date.now())
    }
    tick()
    const timer = setInterval(tick, TICK_MS)
    return () => {
      clearInterval(timer)
    }
  }, [])

  const { headline, detail, tone } = describeLiveState(state, { lastEventAt, attempt })
  const elapsed = lastEventAt === null || nowMs === null ? null : formatElapsedSince(lastEventAt, nowMs)

  return (
    <span
      role={tone === 'stale' ? 'alert' : 'status'}
      aria-live={tone === 'stale' ? 'assertive' : 'polite'}
      title={detail}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLASSES[tone]}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[tone]}`} />
      <span>{headline}</span>
      {elapsed === null ? null : <span className="font-normal">最終更新 {elapsed} 前</span>}
      <span className="sr-only">{detail}</span>
    </span>
  )
}
