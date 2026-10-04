import type { ProjectId, RenderJobId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 書き出した動画のフォルダを Finder で開く口（ADR-0036。制作者 2026-10-03「書き出し画面で生成された動画が
 * あるフォルダを開く導線が欲しい」）。開く前に、まだ入っていない動画を API がフォルダへ入れる。
 *
 * ```
 * GET  /projects/{id}/render-folder       保存先（ホームは ~）と、Finder を開けるか
 * POST /projects/{id}/render-folder/open  入れてから開く（renderJobId を渡すとその 1 本を選んで開く）
 * ```
 */

export const WireRenderFolder = z.object({ location: z.string(), canOpen: z.boolean() })
export type WireRenderFolder = z.infer<typeof WireRenderFolder>

export const WireRenderFolderOpened = z.object({
  location: z.string(),
  copied: z.number().int().nonnegative(),
  failed: z.array(z.object({ reason: z.string() })),
})
export type WireRenderFolderOpened = z.infer<typeof WireRenderFolderOpened>

export type RenderFolderApi = {
  readonly getRenderFolder: (projectId: ProjectId) => Promise<WireRenderFolder>
  readonly openRenderFolder: (projectId: ProjectId, renderJobId?: RenderJobId) => Promise<WireRenderFolderOpened>
}

const path = (projectId: ProjectId, suffix = ''): string =>
  `/projects/${encodeURIComponent(projectId)}/render-folder${suffix}`

export const createRenderFolderApi = (requester: Requester): RenderFolderApi => ({
  getRenderFolder: async (projectId) => requester.get(path(projectId), WireRenderFolder),
  openRenderFolder: async (projectId, renderJobId) =>
    requester.post(path(projectId, '/open'), renderJobId === undefined ? {} : { renderJobId }, WireRenderFolderOpened),
})
