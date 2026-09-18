import type { ReactNode } from 'react'

export type PageHeaderProps = {
  readonly title: string
  readonly description?: string
  readonly action?: ReactNode
}

export const PageHeader = ({ title, description, action }: PageHeaderProps) => (
  <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {description !== undefined && <p className="mt-1 text-sm text-muted">{description}</p>}
    </div>
    {action}
  </header>
)
