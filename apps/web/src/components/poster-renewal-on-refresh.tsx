'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { PosterRenewalContext } from '@/lib/poster-renewal'
import { postersStale } from '@/lib/shot-posters'

/**
 * サーバで描いたページの表紙が読めなくなったときに、ページを描き直してもらう（2026-10-18）。
 *
 * プロジェクト一覧の表紙はサーバが発行した署名付き URL（5 分）で、引き直す持ち主がいなかった。
 * 開いたまま 5 分を過ぎると、下へ送って初めて読む表紙（遅延読み込み）が「読み込めません」のまま残る。
 * `router.refresh()` はサーバの描画だけをやり直すので、新しい URL が届いて絵に戻る（入力中の状態は消えない）。
 *
 * **頼むのは前回から 1 分経ってから**（`postersStale`。ワークベンチと同じ間）。描いたばかりの URL で
 * 読めないなら絵そのものが無く、描き直しても直らない。何枚読めなくても 1 回にまとめる。
 */
export const PosterRenewalOnRefresh = ({ children }: { readonly children: ReactNode }) => {
  const router = useRouter()
  /** 最後にページを描いた（描き直しを頼んだ）時刻。画面に出るまでは null（頼まない）。 */
  const renderedAt = useRef<number | null>(null)
  useEffect(() => {
    renderedAt.current = Date.now()
  }, [])

  const renew = useCallback((): void => {
    if (!postersStale(renderedAt.current, Date.now())) return
    renderedAt.current = Date.now()
    router.refresh()
  }, [router])

  return <PosterRenewalContext.Provider value={renew}>{children}</PosterRenewalContext.Provider>
}
