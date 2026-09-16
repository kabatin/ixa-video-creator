import Link from 'next/link'

export type EmptyStateProps = {
  readonly message: string
  readonly actionHref: string
  readonly actionLabel: string
}

export const EmptyState = ({ message, actionHref, actionLabel }: EmptyStateProps) => (
  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
    <p className="text-sm text-slate-600">{message}</p>
    <Link
      href={actionHref}
      className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
    >
      {actionLabel}
    </Link>
  </div>
)
