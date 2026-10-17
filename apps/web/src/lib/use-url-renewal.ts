'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { mayRenewAfterError, renewDelayMs } from '@/lib/signed-url-renewal'

/**
 * 署名付き URL が入った材料（TimelineDocument など）を取り直す合図。
 *
 * 呼び出し側は `epoch` を取得の effect の依存に入れ、取れたら `markLoaded` を呼ぶ。
 * - **期限の前に取り直す。** 取れてから有効期間の 8 割で `epoch` を進める
 * - **読めなかったら取り直す。** ただし取ってから 1 分は頼まない（素材そのものが無いときに回り続けない）
 *
 * 時刻の決め事は `signed-url-renewal.ts`。ここはタイマーの付け外しだけを持つ。
 */
export type UrlRenewal = {
  /** 進むたびに取り直す。取得の effect の依存に入れる。 */
  readonly epoch: number
  /** 取れたときに呼ぶ。次の取り直しの時刻をここから数える。 */
  readonly markLoaded: () => void
  /** 素材を読めなかったときに呼ぶ。取り直してよいときだけ `epoch` を進める。 */
  readonly renewAfterError: () => void
}

export const useUrlRenewal = (lifetimeSec: number): UrlRenewal => {
  const [epoch, setEpoch] = useState(0)
  /** いまの材料を取れた時刻。取り直している間は null（続けて来た失敗で何度も頼まない）。 */
  const obtainedAtRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback((): void => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const renew = useCallback((): void => {
    clearTimer()
    obtainedAtRef.current = null
    setEpoch((current) => current + 1)
  }, [clearTimer])

  const markLoaded = useCallback((): void => {
    obtainedAtRef.current = Date.now()
    clearTimer()
    timerRef.current = setTimeout(renew, renewDelayMs(lifetimeSec))
  }, [clearTimer, lifetimeSec, renew])

  const renewAfterError = useCallback((): void => {
    if (!mayRenewAfterError(obtainedAtRef.current, Date.now())) return
    renew()
  }, [renew])

  // 画面を離れたら取り直しを止める。
  useEffect(() => clearTimer, [clearTimer])

  return { epoch, markLoaded, renewAfterError }
}
