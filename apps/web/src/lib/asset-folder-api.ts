import type { ProjectId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 作った素材のフォルダを Finder で開く口（ADR-0041。制作者 2026-10-07「作った素材は個別に何かに
 * 使いたいこともあると思うので、普通にフォルダ開いて見れるといいな」）。
 *
 * 開く前に、まだ入っていない素材を API がフォルダへ入れる（ハードリンクなので容量は増えない）。
 *
 * ```
 * GET  /projects/{id}/asset-folder       保存先（ホームは ~）と、Finder を開けるか
 * POST /projects/{id}/asset-folder/open  入れてから開く
 * ```
 */

export const WireAssetFolder = z.object({ location: z.string(), canOpen: z.boolean() })
export type WireAssetFolder = z.infer<typeof WireAssetFolder>

export const WireAssetFolderOpened = z.object({
  location: z.string(),
  linked: z.number().int().nonnegative(),
  failed: z.array(z.object({ reason: z.string() })),
})
export type WireAssetFolderOpened = z.infer<typeof WireAssetFolderOpened>

export type AssetFolderApi = {
  readonly getAssetFolder: (projectId: ProjectId) => Promise<WireAssetFolder>
  readonly openAssetFolder: (projectId: ProjectId) => Promise<WireAssetFolderOpened>
}

const path = (projectId: ProjectId, suffix = ''): string =>
  `/projects/${encodeURIComponent(projectId)}/asset-folder${suffix}`

export const createAssetFolderApi = (requester: Requester): AssetFolderApi => ({
  getAssetFolder: async (projectId) => requester.get(path(projectId), WireAssetFolder),
  openAssetFolder: async (projectId) => requester.post(path(projectId, '/open'), {}, WireAssetFolderOpened),
})

/** 開いたあとに言うこと。黙って開けたなら何も言わない（Finder が前に出れば分かる）。 */
export const assetFolderNotice = (opened: WireAssetFolderOpened): string | null => {
  if (opened.failed.length > 0) {
    return `${String(opened.failed.length)} 件はフォルダに入れられませんでした: ${opened.failed
      .map((failure) => failure.reason)
      .join(' / ')}`
  }
  return opened.linked > 0
    ? `素材 ${String(opened.linked)} 件をフォルダに入れて開きました（${opened.location}）。`
    : null
}
