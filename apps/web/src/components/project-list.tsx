import { ProjectCard } from '@/components/project-card'
import type { ProjectListEntry } from '@/lib/project-list-entry'

export type ProjectListProps = {
  /** 一覧用に写した行（`toProjectListEntry`）。表紙も行が持つ（`cover`）。 */
  readonly projects: readonly ProjectListEntry[]
}

/**
 * 並べ方。**1 列に積まない。** 積むと表紙が画面幅いっぱい（1440px 窓で 1390×780）に
 * なり、1 画面に 1 件しか入らない。ここは「どれを開くか選ぶ」ための画面なので、
 * 表紙は中身が分かる大きさで足り、同時に見えている件数のほうが効く。
 * 幅が狭いときだけ 1 列（そのときは全幅の表紙でちょうどいい）。
 */
export const ProjectList = ({ projects }: ProjectListProps) => (
  <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
    {projects.map((project) => (
      <ProjectCard key={project.id} project={project} />
    ))}
  </ul>
)
