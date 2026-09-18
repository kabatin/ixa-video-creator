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

export const ProjectList = ({ projects, covers }: ProjectListProps) => (
  <ul className="space-y-4">
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
