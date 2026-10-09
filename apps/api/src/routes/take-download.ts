import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { MediaAssetRepository, ProjectRepository, ShotRepository, TakeRepository } from '@ixa/db'
import { ShotId as ShotIdSchema, TakeId as TakeIdSchema, takeDownloadFileName } from '@ixa/domain'
import type { ObjectStorage } from '@ixa/storage'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail } from '../response.js'

/**
 * Take の動画を 1 本ダウンロードする（制作者 2026-10-09「Take の動画を個別に DL できるようにしたい」）。
 *
 * **読める名前で保存させる**（`進め！戦子ちゃん！4 CUT-06 Take 1 採用.mp4`）。保管庫の中の名前は
 * `original.mp4` なので、署名付き URL をそのまま開くと名前で見分けられない。
 *
 * 署名付き URL を発行して渡すのではなく、ここで中身を返す。名前（`Content-Disposition`）を付けるには
 * 応答の頭を自分で書く必要があり、保管庫の署名付き URL ではそれを決められないため。
 */

export type TakeDownloadDeps = {
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly takes: Pick<TakeRepository, 'findById'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  readonly storage: Pick<ObjectStorage, 'get'>
}

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }

/**
 * `Content-Disposition`。日本語の名前は `filename*`（RFC 5987）で渡し、
 * 読めない古い相手のために ASCII だけの `filename` も添える（読めない文字は `_`）。
 */
export const attachmentHeader = (fileName: string): string => {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

const downloadRoute = createRoute({
  method: 'get',
  path: '/shots/{shotId}/takes/{takeId}/download',
  tags: ['shots'],
  summary: 'Take の動画を読める名前で 1 本返す',
  request: {
    params: z.object({
      shotId: ShotIdSchema.openapi({ param: { name: 'shotId', in: 'path' } }),
      takeId: TakeIdSchema.openapi({ param: { name: 'takeId', in: 'path' } }),
    }),
  },
  responses: {
    200: {
      description: '動画そのもの（`Content-Disposition: attachment`）',
      content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } },
    },
    404: errorContent('Shot・Take・素材が無い。または Take がその Shot のものでない'),
  },
})

export const takeDownloadRoutes = (deps: TakeDownloadDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(downloadRoute, async (c) => {
    const { shotId, takeId } = c.req.valid('param')
    const take = await deps.takes.findById(takeId)
    // **別の Shot の Take は断る。** URL の Shot と食い違うものを黙って返さない。
    if (take === null || take.shotId !== shotId) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    const shot = await deps.shots.findById(shotId)
    if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    const project = await deps.projects.findById(shot.projectId)
    const asset = await deps.mediaAssets.findById(take.mediaAssetId)
    if (project === null || asset === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

    // `slice()` で ArrayBuffer に載せ替える（保管庫は SharedArrayBuffer かもしれない型で返す）。
    const body = (await deps.storage.get(asset.storageKey)).slice()
    const fileName = takeDownloadFileName({
      projectName: project.name,
      shotCode: shot.code,
      takeIndex: take.index,
      selected: shot.selectedTakeId === take.id,
      extension: EXTENSION_BY_MIME[asset.mimeType] ?? 'mp4',
    })
    return c.body(body, 200, {
      'Content-Type': asset.mimeType,
      'Content-Length': String(body.byteLength),
      'Content-Disposition': attachmentHeader(fileName),
    })
  })
