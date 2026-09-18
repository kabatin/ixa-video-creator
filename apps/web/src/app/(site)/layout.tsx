import type { ReactNode } from 'react'
import { SiteHeader } from '@/components/site-header'

/**
 * プロジェクト一覧・キャラクター・素材ライブラリの殻。
 * 共通ヘッダと外周の余白はここだけが持つ（ワークベンチは持たない。ADR-0021 D3）。
 */
const SiteLayout = ({ children }: { readonly children: ReactNode }) => (
  <>
    <SiteHeader />
    <div className="px-6 py-6">{children}</div>
  </>
)

export default SiteLayout
