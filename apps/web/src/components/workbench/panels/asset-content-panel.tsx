'use client'

import {
  CharacterId,
  type BrandAsset,
  type Character,
  type CharacterIdentityImage,
  type CharacterLook,
  type Location,
} from '@ixa/domain'
import { BrandAssetManager } from '@/components/brand-asset-manager'
import { CharacterWorkbench } from '@/components/character-workbench'
import { LocationManager } from '@/components/location-manager'
import type { AssetRef } from '@/components/workbench/workbench-context'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelFrame, PanelNotice } from '@/components/workbench/panels/panel-frame'
import { useLoaded } from '@/components/workbench/use-loaded'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { createLibraryClient } from '@/lib/library-api'

/**
 * 素材を中央上のタブとして開く（UI-WORKBENCH 7.3）。中身は既存の部品のまま。
 * 開いたときに自分で読む。**読めなかったことは畳まず出す**（L-015）。
 */
export const AssetContentPanel = ({ asset }: { readonly asset: AssetRef }) => (
  <PanelFrame>
    {asset.kind === 'character' && <CharacterContent id={asset.id} />}
    {asset.kind === 'locations' && <LocationsContent />}
    {asset.kind === 'brand-assets' && <BrandAssetsContent />}
  </PanelFrame>
)

const Loading = () => <p className="text-sm text-muted">読み込んでいます…</p>

type CharacterBundle = {
  readonly character: Character | null
  readonly identityImages: readonly CharacterIdentityImage[]
  readonly looks: readonly CharacterLook[]
}

const CharacterContent = ({ id }: { readonly id: string }) => {
  const parsed = CharacterId.safeParse(id)
  const loaded = useLoaded<CharacterBundle>(
    'キャラクター',
    async () => {
      if (!parsed.success) return { character: null, identityImages: [], looks: [] }
      const api = createApiClient()
      const character = await api.getCharacter(parsed.data)
      if (character === null) return { character: null, identityImages: [], looks: [] }
      const [identityImages, looks] = await Promise.all([
        api.listIdentityImages(parsed.data),
        api.listLooks(parsed.data),
      ])
      return { character, identityImages, looks }
    },
    id,
  )
  if (loaded.state === 'loading') return <Loading />
  if (loaded.state === 'error') return <PanelNotice tone="danger">{loaded.message}</PanelNotice>
  if (loaded.value.character === null) {
    return <PanelNotice tone="warn">このキャラクターは見つかりません（削除された可能性があります）。</PanelNotice>
  }
  return (
    <CharacterWorkbench
      character={loaded.value.character}
      initialIdentityImages={loaded.value.identityImages}
      initialLooks={loaded.value.looks}
    />
  )
}

const LocationsContent = () => {
  const { project } = useWorkbench()
  const loaded = useLoaded<readonly Location[]>(
    'ロケーション',
    () => createLibraryClient(resolveApiBaseUrl()).listLocations(project.workspaceId),
    project.workspaceId,
  )
  if (loaded.state === 'loading') return <Loading />
  return (
    <LocationManager
      workspaceId={project.workspaceId}
      initialLocations={loaded.state === 'ready' ? loaded.value : []}
      loadError={loaded.state === 'error' ? loaded.message : undefined}
    />
  )
}

const BrandAssetsContent = () => {
  const { project } = useWorkbench()
  const loaded = useLoaded<readonly BrandAsset[]>(
    'ブランド資産',
    () => createLibraryClient(resolveApiBaseUrl()).listBrandAssets(project.workspaceId),
    project.workspaceId,
  )
  if (loaded.state === 'loading') return <Loading />
  return (
    <BrandAssetManager
      workspaceId={project.workspaceId}
      initialAssets={loaded.state === 'ready' ? loaded.value : []}
      loadError={loaded.state === 'error' ? loaded.message : undefined}
    />
  )
}
