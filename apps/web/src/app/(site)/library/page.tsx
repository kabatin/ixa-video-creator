import type { BrandAsset, Location, WorkspaceId } from '@ixa/domain'
import Link from 'next/link'
import { BrandAssetManager } from '@/components/brand-asset-manager'
import { ErrorPanel } from '@/components/error-panel'
import { LocationManager } from '@/components/location-manager'
import { PageHeader } from '@/components/page-header'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { CHARACTER_LIST_HREF } from '@/lib/character-links'
import { createLibraryClient } from '@/lib/library-api'
import { resolveWorkspaceId } from '@/lib/workspace'

/**
 * 素材ライブラリ（DOMAIN.md §6 / P55-9）。
 *
 * ロケーションとブランド資産はどちらも **Workspace のもの**で、Project をまたいで使う。
 * キャラクターも同じ Workspace の素材だが、専用の画面がすでにあるのでここからは
 * リンクするだけにする。同じものを 2 箇所で編集できるようにしない。
 *
 * **片方が読めなくても、もう片方は出す。** ただし読めなかったことは畳まず、
 * 「0 件」と区別して渡す（lessons L-015）。
 */

export const dynamic = 'force-dynamic'

type Part<T> = {
  readonly value: readonly T[]
  readonly error: string | undefined
}

const attempt = async <T,>(run: () => Promise<T[]>): Promise<Part<T>> => {
  try {
    return { value: await run(), error: undefined }
  } catch (error) {
    return { value: [], error: describeError(error) }
  }
}

type Loaded = {
  readonly locations: Part<Location>
  readonly brandAssets: Part<BrandAsset>
}

const load = async (workspaceId: WorkspaceId): Promise<Loaded> => {
  const client = createLibraryClient(resolveApiBaseUrl())
  const [locations, brandAssets] = await Promise.all([
    attempt(() => client.listLocations(workspaceId)),
    attempt(() => client.listBrandAssets(workspaceId)),
  ])
  return { locations, brandAssets }
}

const CharacterLink = () => (
  <Link href={CHARACTER_LIST_HREF} className="text-sm text-muted underline hover:text-text">
    キャラクターを編集する
  </Link>
)

const LibraryPage = async () => {
  const workspace = resolveWorkspaceId()

  if (!workspace.ok) {
    return (
      <main>
        <PageHeader title="素材ライブラリ" />
        <ErrorPanel
          title="設定が不足しています"
          message={workspace.reason}
          hint="apps/web/.env.local に NEXT_PUBLIC_WORKSPACE_ID を設定してください。"
        />
      </main>
    )
  }

  const loaded = await load(workspace.workspaceId)

  return (
    <main>
      <PageHeader
        title="素材ライブラリ"
        description="ワークスペース共通の素材。ロケーションは Shot の参照に、ブランド資産はレビューに使われます。"
        action={<CharacterLink />}
      />

      <div className="space-y-12">
        <LocationManager
          workspaceId={workspace.workspaceId}
          initialLocations={loaded.locations.value}
          loadError={loaded.locations.error}
        />

        <BrandAssetManager
          workspaceId={workspace.workspaceId}
          initialAssets={loaded.brandAssets.value}
          loadError={loaded.brandAssets.error}
        />

        <section className="rounded-lg border border-line bg-surface-2 p-6">
          <h2 className="text-lg font-semibold text-text">キャラクター</h2>
          <p className="mt-1 text-sm text-text">
            同一性（Character）と外見（Look）は専用の画面で編集します。
          </p>
          <p className="mt-3">
            <CharacterLink />
          </p>
        </section>
      </div>
    </main>
  )
}

export default LibraryPage
