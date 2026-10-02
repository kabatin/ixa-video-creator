import Link from 'next/link'
import { PageHeader } from '@/components/page-header'

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
      <Link
        href="/"
        className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90"
      >
        プロジェクト一覧へ
      </Link>
    </section>
  </main>
)
