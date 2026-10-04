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
      <main className="mx-auto w-full max-w-5xl">
        <PageHeader title="キャラクター" />
        <ErrorPanel
          title="キャラクター ID が不正です"
          message="このページのアドレスが正しくありません。"
          detail={`アドレスの ID: ${id}`}
          hint="プロジェクトの素材ツリーから辿り直してください。"
        />
      </main>
    )
  }

  const result = await loadCharacter(characterId.data)

  return (
    <main className="mx-auto w-full max-w-5xl">
      <PageHeader
        title={result.ok ? result.character.displayName : 'キャラクター'}
        description="識別画像と Look を揃えるほど、生成した人物が Shot 間でぶれなくなります。"
        action={
          // キャラクターはプロジェクトごと（ADR-0034）。戻る先は持ち主のプロジェクト。
          <Link
            href={result.ok ? `/projects/${encodeURIComponent(result.character.projectId)}` : '/'}
            className="text-sm text-muted underline hover:text-text"
          >
            {result.ok ? 'プロジェクトへ戻る' : 'プロジェクト一覧へ'}
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
          hint="サーバが動いているか確かめてください。"
          detail={`サーバの場所: ${resolveApiBaseUrl()}`}
        />
      )}
    </main>
  )
}

export default CharacterDetailPage
