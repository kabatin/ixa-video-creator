'use client'

import { useCallback, useMemo } from 'react'
import { useAssets } from '@/components/workbench/asset-store'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { fileBaseName } from '@/lib/asset-actions'
import type { Inspected } from '@/lib/workbench-selection'

/** 画像を入れられる先（UI-WORKBENCH-2 §4.5）。Shot と楽曲には画像を入れない。 */
export type ImageTarget =
  | Extract<Inspected, { kind: 'character' | 'look' | 'location' | 'brand-asset' }>
  | { readonly kind: 'new-location' }
  | { readonly kind: 'new-brand-asset' }

export const acceptsImages = (
  selection: Inspected | null,
): selection is Extract<Inspected, { kind: 'character' | 'look' | 'location' | 'brand-asset' }> =>
  selection !== null &&
  (selection.kind === 'character' ||
    selection.kind === 'look' ||
    selection.kind === 'location' ||
    selection.kind === 'brand-asset')

/**
 * 画像を上げて、行き先の素材に付ける。**どの行き先も同じ入口**にする
 * （ビューアに落とした・ツリーから選んだ・画面のどこかに落とした、で振る舞いを変えない）。
 * 付け終わった素材の行き先（Inspected）を返す。呼び出し側はそれを選び直して見せる。
 */
export const useImageAttach = () => {
  const { project } = useWorkbench()
  const { actions, locations, brandAssets } = useAssets()
  const api = useMemo(() => createApiClient(), [])

  const upload = useCallback(
    async (file: File) =>
      (await api.uploadMedia(file, { workspaceId: project.workspaceId, kind: 'image' })).id,
    [api, project.workspaceId],
  )

  return useCallback(
    async (target: ImageTarget, files: readonly File[]): Promise<Inspected> => {
      if (files.length === 0) throw new Error('画像がありません')
      switch (target.kind) {
        case 'character': {
          const existing = await api.listIdentityImages(target.id)
          for (const [index, file] of files.entries()) {
            await api.addIdentityImage(target.id, {
              mediaAssetId: await upload(file),
              role: 'full_body',
              isPrimary: existing.length === 0 && index === 0,
              order: existing.length + index,
            })
          }
          return target
        }
        case 'look': {
          const existing = await api.listLookImages(target.id)
          for (const [index, file] of files.entries()) {
            await api.addLookImage(target.id, {
              mediaAssetId: await upload(file),
              role: 'reference_still',
              isPrimary: existing.length === 0 && index === 0,
              order: existing.length + index,
            })
          }
          return target
        }
        case 'location':
        case 'new-location': {
          const location =
            target.kind === 'location'
              ? (locations.state === 'ready' ? locations.value : []).find(
                  (item) => item.id === target.id,
                )
              : await actions.createLocation(fileBaseName(files[0]?.name ?? 'ロケーション'))
          if (location === undefined) throw new Error('ロケーションが見つかりません')
          const added = []
          for (const file of files) added.push(await upload(file))
          await actions.updateLocation(location.id, {
            referenceAssetIds: [...location.referenceAssetIds, ...added],
          })
          return { kind: 'location', id: location.id }
        }
        case 'brand-asset':
        case 'new-brand-asset': {
          // ブランド資産は画像 1 枚。2 枚以上なら先頭だけ使う（残りは黙って捨てず、呼び出し側が伝える）。
          const first = files[0]
          if (first === undefined) throw new Error('画像がありません')
          const asset =
            target.kind === 'brand-asset'
              ? (brandAssets.state === 'ready' ? brandAssets.value : []).find(
                  (item) => item.id === target.id,
                )
              : await actions.createBrandAsset(fileBaseName(first.name), 'logo')
          if (asset === undefined) throw new Error('ブランド資産が見つかりません')
          await actions.updateBrandAsset(asset.id, { mediaAssetId: await upload(first) })
          return { kind: 'brand-asset', id: asset.id }
        }
      }
    },
    [actions, api, brandAssets, locations, upload],
  )
}
