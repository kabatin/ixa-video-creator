import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  MediaAssetRepository,
  ProjectRepository,
  ShotReferenceRepository,
  ShotRepository,
} from '@ixa/db'
import { MediaAssetId as MediaAssetIdSchema, ShotId as ShotIdSchema, type ShotId } from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * Shot の最初のフレーム（ADR-0025）。画像を 1 枚付け、ローカルの画像→動画などで Take にする。
 *
 * 中身は**手動の参照 `start_frame` 1 件**。生成の仕様を組む側（`packages/generation` の
 * context）が手動の参照をそのまま拾うので、ここは付け外しだけを持つ。
 * 手動で付けた他の役割の参照には触らない。
 */

export type ShotStartFrameRoutesDeps = {
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  readonly shotReferences: Pick<ShotReferenceRepository, 'findByShot' | 'create' | 'delete'>
}

const NOT_IMAGE_MESSAGE = '最初のフレームには画像を指定してください'
const FOREIGN_ASSET_MESSAGE = 'この Project のワークスペースの画像ではありません'

const ShotParams = z.object({
  id: ShotIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})
const StartFrameBody = z.object({ mediaAssetId: MediaAssetIdSchema }).openapi('SetStartFrameInput')
const StartFrameData = z
  .object({ mediaAssetId: MediaAssetIdSchema.nullable() })
  .openapi('ShotStartFrame')

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
  method: 'get', path: '/shots/{id}/start-frame', tags: ['shots'],
  summary: 'Shot の最初のフレーム（無ければ null）',
  request: { params: ShotParams },
  responses: { 200: jsonContent('最初のフレーム', successResponse(StartFrameData)), ...commonErrors },
})

const putRoute = createRoute({
  method: 'put', path: '/shots/{id}/start-frame', tags: ['shots'],
  summary: 'Shot の最初のフレームを付ける（付いていれば置き換える）',
  request: {
    params: ShotParams,
    body: { required: true, content: { 'application/json': { schema: StartFrameBody } } },
  },
  responses: { 200: jsonContent('付けた最初のフレーム', successResponse(StartFrameData)), ...commonErrors },
})

const deleteRoute = createRoute({
  method: 'delete', path: '/shots/{id}/start-frame', tags: ['shots'],
  summary: 'Shot の最初のフレームを外す',
  request: { params: ShotParams },
  responses: { 204: { description: '外した（本文なし）' }, ...commonErrors },
})

/** 手動で付けた最初のフレーム。**手動のものだけ**（導かれた参照には触らない）。 */
const manualStartFrames = async (deps: ShotStartFrameRoutesDeps, shotId: ShotId) =>
  (await deps.shotReferences.findByShot(shotId)).filter(
    (reference) => reference.role === 'start_frame' && reference.sourceKind === 'manual',
  )

const removeAll = async (deps: ShotStartFrameRoutesDeps, shotId: ShotId): Promise<void> => {
  for (const reference of await manualStartFrames(deps, shotId)) {
    await deps.shotReferences.delete(reference.id)
  }
}

export const shotStartFrameRoutes = (deps: ShotStartFrameRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(getRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const [current] = await manualStartFrames(deps, shot.id)
      return c.json(ok({ mediaAssetId: current?.mediaAssetId ?? null }), 200)
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

      await removeAll(deps, shot.id)
      await deps.shotReferences.create({
        shotId: shot.id,
        mediaAssetId,
        role: 'start_frame',
        weight: 1,
        order: 0,
        sourceKind: 'manual',
      })
      return c.json(ok({ mediaAssetId }), 200)
    })
    .openapi(deleteRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      await removeAll(deps, shot.id)
      return c.body(null, 204)
    })
