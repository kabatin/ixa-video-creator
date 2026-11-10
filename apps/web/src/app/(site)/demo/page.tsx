import { DemoInstall } from '@/components/demo-install'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { resolveWorkspaceId } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

/** 見本を開く（ADR-0067）。入れ終えたら見本の作品のワークベンチへ移る。 */
const DemoPage = () => {
  const workspace = resolveWorkspaceId()

  return (
    <main className="mx-auto w-full max-w-3xl">
      <PageHeader title="見本を開く" description="曲と Shot と絵がそろった見本の作品を開きます。" />
      {workspace.ok ? (
        <DemoInstall workspaceId={workspace.workspaceId} />
      ) : (
        <ErrorPanel
          title="設定が不足しています"
          message={workspace.reason}
          hint="作業場所の設定が読めていません。開発の手順書（README）の「はじめに」に沿って設定してください。"
          detail="apps/web/.env.local の NEXT_PUBLIC_WORKSPACE_ID"
          actions={[{ href: '/', label: '一覧へ戻る' }]}
        />
      )}
    </main>
  )
}

export default DemoPage
