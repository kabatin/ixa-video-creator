'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useRef, type ReactNode } from 'react'
import { PosterRenewalContext } from '@/lib/poster-renewal'
import { postersStale } from '@/lib/shot-posters'

/**
 * サーバで描いたページの表紙が読めなくなったときに、ページを描き直してもらう（2026-10-18）。
 *
 * プロジェクト一覧の表紙はサーバが発行した署名付き URL（5 分）で、引き直す持ち主がいなかった。
 * 開いたまま 5 分を過ぎると、下へ送って初めて読む表紙（遅延読み込み）が「読み込めません」のまま残る。
 * `router.refresh()` はサーバの描画だけをやり直すので、新しい URL が届いて絵に戻る（入力中の状態は消えない）。
 *
 * **1 分の間は URL を発行した時刻（`issuedAtMs`、サーバが描いた時刻）から数える。** 画面に出た時刻から数えると、
 * 戻るボタンで出た古いページ（Next の Router Cache。URL は 10 分前のもの）の表紙が最初の 1 分で全部 403 になり、
 * それを「描いたばかりで読めない＝絵が無い」と読み違えて、二度と描き直さなかった。
 *
 * 発行して 1 分以内に読めないなら絵そのものが無く、描き直しても直らないので頼まない。
 * **同じページ（同じ発行時刻）では 1 回だけ頼む。** 新しいページが届くまでに何枚読めなくても 1 回にまとめる。
 */
export type PosterRenewalOnRefreshProps = {
  /** 表紙の URL をサーバが発行した時刻（ミリ秒）。描き直すたびに新しい値が届く。 */
  readonly issuedAtMs: number
  readonly children: ReactNode
}

export const PosterRenewalOnRefresh = ({ issuedAtMs, children }: PosterRenewalOnRefreshProps) => {
  const router = useRouter()
  /** 描き直しを頼んだページの発行時刻。 */
  const askedForRef = useRef<number | null>(null)

  const renew = useCallback((): void => {
    if (askedForRef.current === issuedAtMs) return
    if (!postersStale(issuedAtMs, Date.now())) return
    askedForRef.current = issuedAtMs
    router.refresh()
  }, [issuedAtMs, router])

  return <PosterRenewalContext.Provider value={renew}>{children}</PosterRenewalContext.Provider>
}
