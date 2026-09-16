import Link from 'next/link'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { ProjectForm } from '@/components/project-form'
import { resolveWorkspaceId } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

const BackLink = () => (
  <Link href="/" className="text-sm text-slate-600 underline hover:text-slate-900">
    一覧へ戻る
  </Link>
)

const NewProjectPage = () => {
  const workspace = resolveWorkspaceId()

  return (
    <main>
      <PageHeader
        title="新規プロジェクト"
        description="出力仕様はレンダリングと Provider 選択の制約になります。"
        action={<BackLink />}
      />
      {workspace.ok ? (
        <ProjectForm workspaceId={workspace.workspaceId} />
      ) : (
        <ErrorPanel
          title="設定が不足しています"
          message={workspace.reason}
          hint="apps/web/.env.local に NEXT_PUBLIC_WORKSPACE_ID を設定してください。"
        />
      )}
    </main>
  )
}

export default NewProjectPage
