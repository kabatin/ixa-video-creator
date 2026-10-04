import { PageHeader } from '@/components/page-header'
import { LinkButton } from '@/components/ui/button'

/**
 * キャラクター・ロケーション・ブランド資産は**プロジェクトごと**になった（ADR-0034。制作者 2026-10-03
 * 「全プロジェクトで共有になっている。プロジェクト単位にしないと大変なことになる」）。
 *
 * ワークスペース全体を並べていた一覧（キャラクター・素材ライブラリ）は、プロジェクトごとと食い違うのでたたんだ。
 * 作る・直す・ほかのプロジェクトから取り込むは、プロジェクトの左の素材ツリーで行う。古いリンクから来た人を迷わせない。
 */
export const LibraryMovedNotice = ({ title }: { readonly title: string }) => (
  <main className="mx-auto w-full max-w-3xl">
    <PageHeader title={title} />
    <section className="space-y-3 rounded-lg border border-line bg-surface p-6 text-sm text-text">
      <p>キャラクター・ロケーション・ブランド資産は、プロジェクトごとになりました。</p>
      <p className="text-muted">
        プロジェクトを開き、左の素材ツリーで作成・編集してください。ほかのプロジェクトのものを使うときは、
        素材ツリーの「ほかのプロジェクトから取り込む…」で複製できます。
      </p>
      <LinkButton href="/" tone="primary">
        プロジェクト一覧へ
      </LinkButton>
    </section>
  </main>
)
