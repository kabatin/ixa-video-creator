import {
  CharacterId,
  type Character,
  type CharacterIdentityImage,
  type CharacterLook,
} from '@ixa/domain'
import Link from 'next/link'
import { CharacterWorkbench } from '@/components/character-workbench'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { CHARACTER_LIST_HREF } from '@/lib/character-links'

export const dynamic = 'force-dynamic'

type CharacterPageProps = {
  readonly params: Promise<{ readonly id: string }>
}

type LoadResult =
  | {
      readonly ok: true
      readonly character: Character
      readonly identityImages: readonly CharacterIdentityImage[]
      readonly looks: readonly CharacterLook[]
    }
  | { readonly ok: false; readonly title: string; readonly message: string }

/** 失敗は必ず表示可能な値へ畳み、ページを落とさない。 */
const loadCharacter = async (id: CharacterId): Promise<LoadResult> => {
  const client = createApiClient()
  try {
    const character = await client.getCharacter(id)
    if (character === null) {
      return {
        ok: false,
        title: 'キャラクターが見つかりません',
        message: `${id} というキャラクターはありません。`,
      }
    }
    const [identityImages, looks] = await Promise.all([
      client.listIdentityImages(id),
      client.listLooks(id),
    ])
    return { ok: true, character, identityImages, looks }
  } catch (error) {
    return {
      ok: false,
      title: 'キャラクターを読み込めませんでした',
      message: describeError(error),
    }
  }
}

const CharacterDetailPage = async ({ params }: CharacterPageProps) => {
  const { id } = await params
  const characterId = CharacterId.safeParse(id)

  if (!characterId.success) {
    return (
      <main>
        <PageHeader title="キャラクター" />
        <ErrorPanel
          title="キャラクター ID が不正です"
          message={`URL の ID が ULID ではありません: ${id}`}
          hint="キャラクター一覧から辿り直してください。"
        />
      </main>
    )
  }

  const result = await loadCharacter(characterId.data)

  return (
    <main>
      <PageHeader
        title={result.ok ? result.character.displayName : 'キャラクター'}
        description="識別画像と Look を揃えるほど、生成した人物が Shot 間でぶれなくなります。"
        action={
          <Link
            href={CHARACTER_LIST_HREF}
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            一覧へ戻る
          </Link>
        }
      />
      {result.ok ? (
        <CharacterWorkbench
          character={result.character}
          initialIdentityImages={result.identityImages}
          initialLooks={result.looks}
        />
      ) : (
        <ErrorPanel
          title={result.title}
          message={result.message}
          hint={`API (${resolveApiBaseUrl()}) が起動しているか確認してください。`}
        />
      )}
    </main>
  )
}

export default CharacterDetailPage
