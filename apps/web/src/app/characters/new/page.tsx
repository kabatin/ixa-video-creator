import Link from 'next/link'
import { CharacterForm } from '@/components/character-form'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { CHARACTER_LIST_HREF } from '@/lib/character-links'
import { resolveWorkspaceId } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

const BackLink = () => (
  <Link
    href={CHARACTER_LIST_HREF}
    className="text-sm text-slate-600 underline hover:text-slate-900"
  >
    一覧へ戻る
  </Link>
)

const NewCharacterPage = () => {
  const workspace = resolveWorkspaceId()

  return (
    <main>
      <PageHeader
        title="新規キャラクター"
        description="ここには Look で変わらない同一性だけを登録します。衣装や髪色は作成後に Look として足します。"
        action={<BackLink />}
      />
      {workspace.ok ? (
        <CharacterForm workspaceId={workspace.workspaceId} />
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

export default NewCharacterPage
