'use client'

import { useCallback } from 'react'
import { useOptionalContextMenuHost } from '@/components/workbench/ui/context-menu'

/**
 * 生成のあとに「自動レビューをするか」を聞く口（`offer-review.ts` の confirm）。
 * 画面全体を止める `window.confirm` をやめ、ワークベンチの確認で聞く（押せば true、閉じれば false）。
 * 確認の置き場が無い所（単体で描くとき）では聞かずに false（「あとでレビューできる」と知らせる）。
 */
export const useAskReview = (): ((message: string) => Promise<boolean>) => {
  const host = useOptionalContextMenuHost()
  return useCallback(
    (message: string) =>
      host === null
        ? Promise.resolve(false)
        : host.ask({ title: '自動レビュー', message, confirmLabel: 'レビューする', keepLabel: 'あとで' }),
    [host],
  )
}
