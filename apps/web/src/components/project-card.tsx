import type { Project } from '@ixa/domain'
import Link from 'next/link'
import { ShotPoster } from '@/components/shot-poster'
import { describeProjectSpec } from '@/lib/project-spec-choices'
import { formatCreatedAt, statusClassName, statusLabel } from '@/lib/project-display'
import { workbenchHref } from '@/lib/workbench-url'

export type ProjectCardProps = {
  readonly project: Project
  /**
   * 表紙にする絵（`pickProjectCover` が選ぶ）。**`undefined` は「呼び出し側がまだ繋いでいない」**。
   * `null` は「繋がっているが絵が無い」で、そのときは `coverReason` に理由が入る。
   * 2 つを混ぜると、繋ぎ忘れが「Take がありません」に化ける（L-021）。
   */
  readonly coverUrl?: string | null
  readonly coverReason?: string | null
}

/**
 * プロジェクト 1 件。**行き先は 1 つだけ**（そのプロジェクトのワークベンチ）。
 *
 * 以前はここに「楽曲 / ストーリーボード / Shot 一覧 / タイムライン / 書き出し / 設定」の
 * 6 本を並べていた。ワークベンチになる前の画面割りをそのまま残したもので、
 * 実際の行き先は 6 本とも同じ 1 画面（違うのはクエリだけ）だった。
 * 入口で作業の順番を選ばせる意味が無く、中に入ってから決めればよい。
 */
export const ProjectCard = ({ project, coverUrl, coverReason }: ProjectCardProps) => (
  <li className="rounded-lg border border-line bg-surface shadow-sm transition hover:border-accent/60 hover:shadow-md">
    <Link
      href={workbenchHref(project.id)}
      className="block rounded-lg p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {(coverUrl !== undefined || coverReason !== undefined) && (
        <div className="mb-4">
          <ShotPoster
            url={coverUrl ?? null}
            reason={coverReason ?? null}
            alt={`${project.name} の表紙`}
            size="card"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-text">{project.name}</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClassName(project.status)}`}
        >
          {statusLabel(project.status)}
        </span>
      </div>
      {/* 形・大きさ・fps を読める 1 行に（以前は「1920×1080」「16:9」「30」を別々の欄に並べていた）。 */}
      <p className="mt-3 text-sm text-text">{describeProjectSpec(project)}</p>
      <p className="mt-1 text-xs text-muted">{`作成 ${formatCreatedAt(project)}`}</p>
    </Link>
  </li>
)
