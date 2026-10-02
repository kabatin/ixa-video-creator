'use client'

import { createContext } from 'react'

/**
 * サムネイルを読めなかったときに、一覧の引き直しを頼む口（制作者 2026-10-02「サムネが表示されなくなった」）。
 *
 * サムネイルの URL は署名付きで 5 分で切れる。帯を横に送って初めて見える絵（遅延読み込み）は、
 * 切れた URL で取りにいって「読み込めません」のまま残っていた。持ち主はワークベンチ（`workbench-provider`）。
 * 持ち主の外（一覧のページなど）では null で、頼む先が無い（今までどおり「読み込めません」）。
 */
export const PosterRenewalContext = createContext<(() => void) | null>(null)
PosterRenewalContext.displayName = 'PosterRenewalContext'
