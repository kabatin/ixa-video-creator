import { AccessKeysPanel } from '@/components/access-keys-panel'
import { PageHeader } from '@/components/page-header'

export const dynamic = 'force-dynamic'

/** アクセス用の鍵（認証。2026-10-09）。Claude・Codex（MCP）に渡す鍵を発行・取り消しする。 */
const AccessKeysPage = () => (
  <main className="mx-auto w-full max-w-3xl">
    <PageHeader
      title="アクセス用の鍵"
      description="Claude や Codex から使うときに渡す鍵です。鍵を持っていれば合言葉なしで使えるので、要らなくなったら取り消してください。"
    />
    <AccessKeysPanel />
  </main>
)

export default AccessKeysPage
