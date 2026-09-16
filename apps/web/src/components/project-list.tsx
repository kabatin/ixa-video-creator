import type { Project } from '@ixa/domain'
import { ProjectCard } from '@/components/project-card'

export type ProjectListProps = {
  readonly projects: readonly Project[]
}

export const ProjectList = ({ projects }: ProjectListProps) => (
  <ul className="space-y-4">
    {projects.map((project) => (
      <ProjectCard key={project.id} project={project} />
    ))}
  </ul>
)
