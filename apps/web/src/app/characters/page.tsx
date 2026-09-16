import type { WorkspaceId } from '@ixa/domain'
import Link from 'next/link'
import { CharacterTable } from '@/components/character-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { NEW_CHARACTER_HREF } from '@/lib/character-links'
import { toCharacterSummary, type CharacterSummary } from '@/lib/character-summary'
import { FOUR_VIEW_NOTICE } from '@/lib/identity-images'
import { resolveWorkspaceId } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

type LoadResult =
  | { readonly ok: true; readonly summaries: readonly CharacterSummary[] }
  | { readonly ok: false; readonly message: string }

/**
 * 一覧には Look 数と識別画像の状況まで出す。
 * API に集計が無いため、Character ごとに Look と識別画像を引いて畳む。
 * 失敗は必ず表示可能な値へ畳み、ページを落とさない。
 */
const loadLibrary = async (workspaceId: WorkspaceId): Promise<LoadResult> => {
  const client = createApiClient()
  try {
    const characters = await client.listCharacters(workspaceId)
    const summaries = await Promise.all(
      characters.map(async (character) => {
        const [identityImages, looks] = await Promise.all([
          client.listIdentityImages(character.id),
          client.listLooks(character.id),
        ])
        return toCharacterSummary(character, identityImages, looks)
      }),
    )
    return { ok: true, summaries }
  } catch (error) {
    return { ok: false, message: describeError(error) }
  }
}

const NewCharacterLink = () => (
  <div className="flex items-center gap-3">
    <Link href="/" className="text-sm text-slate-600 underline hover:text-slate-900">
      プロジェクト一覧
    </Link>
    <Link
      href={NEW_CHARACTER_HREF}
      className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
    >
      新規キャラクター
    </Link>
  </div>
)

const CharactersPage = async () => {
  const workspace = resolveWorkspaceId()

  if (!workspace.ok) {
    return (
      <main>
        <PageHeader title="キャラクター" />
        <ErrorPanel
          title="設定が不足しています"
          message={workspace.reason}
          hint="apps/web/.env.local に NEXT_PUBLIC_WORKSPACE_ID を設定してください。"
        />
      </main>
    )
  }

  const result = await loadLibrary(workspace.workspaceId)

  return (
    <main>
      <PageHeader
        title="キャラクター"
        description="同一性（Character）と、時系列で変わる外見（Look）の 2 層で人物を管理します。"
        action={<NewCharacterLink />}
      />

      <p className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        {FOUR_VIEW_NOTICE}
      </p>

      {!result.ok ? (
        <ErrorPanel
          title="キャラクターを読み込めませんでした"
          message={result.message}
          hint={`API (${resolveApiBaseUrl()}) が起動しているか確認してください。`}
        />
      ) : result.summaries.length === 0 ? (
        <EmptyState
          message="キャラクターがありません"
          actionHref={NEW_CHARACTER_HREF}
          actionLabel="最初のキャラクターを作成"
        />
      ) : (
        <CharacterTable summaries={result.summaries} />
      )}
    </main>
  )
}

export default CharactersPage
