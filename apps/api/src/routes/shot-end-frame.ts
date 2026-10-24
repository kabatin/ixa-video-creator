import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  EditTransaction,
  MediaAssetRepository,
  ProjectRepository,
  ShotReferenceRepository,
  ShotRepository,
} from '@ixa/db'
import { MediaAssetId as MediaAssetIdSchema, ShotId as ShotIdSchema, ShotTiming } from '@ixa/domain'
import { clearManualEndFrame, manualEndFrameOf, replaceManualEndFrame } from '@ixa/generation'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { recordShotAttachments } from './shot-edit-recording.js'

/**
 * Shot の終わりの画像（2026-10-24）。動画の**最後のコマ**になる 1 枚（ループなら最初の Shot の開始画像）。
 *
 * 中身は**手動の参照 `end_frame` 1 件**。生成の仕様を組む側が手動の参照をそのまま拾う。
 *
 * **付けると Shot を「Take を尺に合わせる」（`timing: 'fit'`）にする。** 動画の AI が作る長さは Shot の尺より
 * 少し長く（H3 は 17n+5 コマ）、終わりの画像はファイルの最後に来る。切り詰めたままだと最後の数コマが
 * 画面に出ず、終わりの画像で終わらない。合わせれば Take の最後まで尺に収めて再生する（数 % 速くなるだけ）。
 * 外しても `timing` は戻さない（制作者が選び直せる。戻すのは取り消し）。
 */

export type ShotEndFrameRoutesDeps = {
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  readonly shotReferences: Pick<ShotReferenceRepository, 'findByShot'>
  /** 記録と書き込みを同じトランザクションで行う（取り消し）。**省けない。** */
  readonly transaction: EditTransaction
}

const NOT_IMAGE_MESSAGE = '終わりの画像には画像を指定してください'
const FOREIGN_ASSET_MESSAGE = 'この Project のワークスペースの画像ではありません'

const ShotParams = z.object({
  id: ShotIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})
const EndFrameBody = z.object({ mediaAssetId: MediaAssetIdSchema }).openapi('SetEndFrameInput')
const EndFrameData = z.object({ mediaAssetId: MediaAssetIdSchema.nullable() }).openapi('ShotEndFrame')
const EndFrameSaved = z
  .object({ mediaAssetId: MediaAssetIdSchema, timing: ShotTiming })
  .openapi('ShotEndFrameSaved')

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const commonErrors = {
  404: errorContent('Shot が存在しない'),
  422: errorContent('画像ではない / 別のワークスペースの素材'),
  500: errorContent('サーバ内部エラー'),
}

const getRoute = createRoute({
  method: 'get', path: '/shots/{id}/end-frame', tags: ['shots'],
  summary: 'Shot の終わりの画像（無ければ null）',
  request: { params: ShotParams },
  responses: { 200: jsonContent('終わりの画像', successResponse(EndFrameData)), ...commonErrors },
})

const putRoute = createRoute({
  method: 'put', path: '/shots/{id}/end-frame', tags: ['shots'],
  summary: 'Shot の終わりの画像を付ける（付いていれば置き換える）。Shot は「Take を尺に合わせる」になる',
  request: {
    params: ShotParams,
    body: { required: true, content: { 'application/json': { schema: EndFrameBody } } },
  },
  responses: { 200: jsonContent('付けた終わりの画像', successResponse(EndFrameSaved)), ...commonErrors },
})

const deleteRoute = createRoute({
  method: 'delete', path: '/shots/{id}/end-frame', tags: ['shots'],
  summary: 'Shot の終わりの画像を外す',
  request: { params: ShotParams },
  responses: { 204: { description: '外した（本文なし）' }, ...commonErrors },
})

export const shotEndFrameRoutes = (deps: ShotEndFrameRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(getRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok({ mediaAssetId: await manualEndFrameOf(deps.shotReferences, shot.id) }), 200)
    })
    .openapi(putRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const project = await deps.projects.findById(shot.projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const { mediaAssetId } = c.req.valid('json')
      const asset = await deps.mediaAssets.findById(mediaAssetId)
      const reason =
        asset === null || asset.workspaceId !== project.workspaceId
          ? FOREIGN_ASSET_MESSAGE
          : asset.kind !== 'image'
            ? NOT_IMAGE_MESSAGE
            : null
      if (reason !== null) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { mediaAssetId: [reason] }), 422)
      }

      const before = await manualEndFrameOf(deps.shotReferences, shot.id)
      const patch = shot.timing === 'fit' ? {} : { timing: shot.timing }
      await deps.transaction(async (tx) => {
        await recordShotAttachments(tx.editBatches, shot, { kind: 'endFrame', before, after: mediaAssetId, patch })
        await replaceManualEndFrame(tx.shotReferences, shot.id, mediaAssetId)
        if (shot.timing !== 'fit') await tx.shots.update(shot.id, { timing: 'fit' })
      })
      return c.json(ok({ mediaAssetId, timing: 'fit' as const }), 200)
    })
    .openapi(deleteRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const before = await manualEndFrameOf(deps.shotReferences, shot.id)
      await deps.transaction(async (tx) => {
        await recordShotAttachments(tx.editBatches, shot, { kind: 'endFrame', before, after: null, patch: {} })
        await clearManualEndFrame(tx.shotReferences, shot.id)
      })
      return c.body(null, 204)
    })
