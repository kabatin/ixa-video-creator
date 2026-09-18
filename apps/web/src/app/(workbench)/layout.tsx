import type { ReactNode } from 'react'

/**
 * ワークベンチの殻。**ヘッダも外周の余白も持たない**（ADR-0021 D3）。
 * メニューバーが共通ヘッダの役目を引き取り、画面の高さをちょうど使い切る。
 */
const WorkbenchLayout = ({ children }: { readonly children: ReactNode }) => (
  <div className="h-screen overflow-hidden">{children}</div>
)

export default WorkbenchLayout
