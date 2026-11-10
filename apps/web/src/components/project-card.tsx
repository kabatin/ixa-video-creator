import Link from 'next/link'
import { ProjectCardFrame } from '@/components/project-list-actions'
import { ShotPoster } from '@/components/shot-poster'
import type { WireProjectListItem } from '@/lib/api-schemas'
import { projectKindLabel } from '@/lib/project-kind-display'
import { describeProjectSpec } from '@/lib/project-spec-choices'
import {
  lastActivityLabel,
  projectProgressLine,
  showsStatusPill,
  statusClassName,
  statusLabel,
} from '@/lib/project-display'
import { workbenchHref } from '@/lib/workbench-url'

export type ProjectCardProps = {
  /** 一覧の 1 行（作品の欄と進み具合）。 */
  readonly project: WireProjectListItem
  /**
   * 表紙にする絵（`pickProjectCover` が選ぶ）。**`undefined` は「呼び出し側がまだ繋いでいない」**。
   * `null` は「繋がっているが絵が無い」で、そのときは `coverReason` に理由が入る。
   * 2 つを混ぜると、繋ぎ忘れが「Take がありません」に化ける（L-021）。
   */
  readonly coverUrl?: string | null
  readonly coverReason?: string | null
}

/**
 * プロジェクト 1 件。**押したときの行き先は 1 つだけ**（そのプロジェクトのワークベンチ）。
 *
 * 以前はここに「楽曲 / ストーリーボード / Shot 一覧 / タイムライン / 書き出し / 設定」の
 * 6 本を並べていた。ワークベンチになる前の画面割りをそのまま残したもので、
 * 実際の行き先は 6 本とも同じ 1 画面（違うのはクエリだけ）だった。
 * 入口で作業の順番を選ばせる意味が無く、中に入ってから決めればよい。
 *
 * 作品そのものへの操作（複製・削除・素材置き場にする）だけは、開かずにできるよう右下の「…」と右クリックに置く
 * （制作者 2026-10-04「プロジェクト一覧でプロジェクト削除出来るようにしてほしい。複製もプロジェクト一覧からも出来るといい」）。
 *
 * どれを開くか選べるよう、種類・どこまで進んだか・最後に触った時刻を出す。状態の札は、はじめの「企画」のままなら出さない
 * （手で変えるまで全部「企画」なので、出しても何も言っていない）。
 */
export const ProjectCard = ({ project, coverUrl, coverReason }: ProjectCardProps) => {
  const progress = projectProgressLine(project.kind, project.activity)
  return (
    <ProjectCardFrame project={{ id: project.id, name: project.name, kind: project.kind }}>
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
          {showsStatusPill(project.status) && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClassName(project.status)}`}
            >
              {statusLabel(project.status)}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">{projectKindLabel(project.kind)}</p>
        {/* 形・大きさ・fps を読める 1 行に（以前は「1920×1080」「16:9」「30」を別々の欄に並べていた）。 */}
        <p className="mt-3 text-sm text-text">{describeProjectSpec(project)}</p>
        {progress !== null && <p className="mt-1 text-sm text-text">{progress}</p>}
        <p className="mt-1 text-xs text-muted">{lastActivityLabel(project.activity)}</p>
      </Link>
    </ProjectCardFrame>
  )
}
