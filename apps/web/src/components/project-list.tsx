import type { Project, ProjectId } from '@ixa/domain'
import { ProjectCard } from '@/components/project-card'
import type { PosterView } from '@/lib/shot-posters'

export type ProjectListProps = {
  readonly projects: readonly Project[]
  /**
   * カードの絵。**渡さなければ絵の枠ごと出ない**（繋がっていない）。
   * 渡して `url` が null なら「絵が無い」で、理由が付く。混ぜない（L-015）。
   */
  readonly covers?: ReadonlyMap<ProjectId, PosterView>
}

/**
 * 並べ方。**1 列に積まない。** 積むと表紙が画面幅いっぱい（1440px 窓で 1390×780）に
 * なり、1 画面に 1 件しか入らない。ここは「どれを開くか選ぶ」ための画面なので、
 * 表紙は中身が分かる大きさで足り、同時に見えている件数のほうが効く。
 * 幅が狭いときだけ 1 列（そのときは全幅の表紙でちょうどいい）。
 */
export const ProjectList = ({ projects, covers }: ProjectListProps) => (
  <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
    {projects.map((project) => {
      const cover = covers?.get(project.id)
      return (
        <ProjectCard
          key={project.id}
          project={project}
          coverUrl={cover?.url}
          coverReason={cover?.reason}
        />
      )
    })}
  </ul>
)
