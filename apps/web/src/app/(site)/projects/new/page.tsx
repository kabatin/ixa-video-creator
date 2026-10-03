import Link from 'next/link'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { ProjectForm } from '@/components/project-form'
import { resolveWorkspaceId } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

const BackLink = () => (
  <Link href="/" className="text-sm text-muted underline hover:text-text">
    一覧へ戻る
  </Link>
)

const NewProjectPage = () => {
  const workspace = resolveWorkspaceId()

  return (
    <main className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="新規プロジェクト"
        description="画面の形・大きさ・なめらかさは、書き出す動画と AI で作る動画の形になります。あとからプロジェクトの設定で変えられます。"
        action={<BackLink />}
      />
      {workspace.ok ? (
        <ProjectForm workspaceId={workspace.workspaceId} />
      ) : (
        <ErrorPanel
          title="設定が不足しています"
          message={workspace.reason}
          hint="作業場所の設定が読めていません。開発の手順書（README）の「はじめに」に沿って設定してください。"
          detail="apps/web/.env.local の NEXT_PUBLIC_WORKSPACE_ID"
        />
      )}
    </main>
  )
}

export default NewProjectPage
