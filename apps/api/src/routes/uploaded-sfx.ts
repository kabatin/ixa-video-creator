import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { MediaAssetRepository, ProjectRepository, UploadedSfxRepository } from '@ixa/db'
import {
  MediaAssetId as MediaAssetIdSchema,
  ProjectId as ProjectIdSchema,
  UploadedSfxTitle,
  type UploadedSfx,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * 手元のファイルから取り込んだ効果音（ADR-0056。制作者 2026-10-19「ドラッグしたとき、楽曲か効果音かを選べるようにしましょう」）。
 * 上げた音の素材を、作品の効果音として記す。効果音の段には置かない（素材ツリーから段へ置く）。
 */

export const MISSING_SFX_ASSET_MESSAGE = '指定された音の素材が見つかりません'
export const NOT_AUDIO_SFX_MESSAGE = '音声以外の素材は効果音として取り込めません'

const ProjectParams = z.object({ projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }) })

const UploadBody = z
  .object({ mediaAssetId: MediaAssetIdSchema, title: UploadedSfxTitle })
  .strict()
  .openapi('UploadSfx')

const UploadedSfxResponse = z
  .object({ id: z.string(), mediaAssetId: z.string(), title: z.string(), createdAt: z.string().datetime() })
  .openapi('UploadedSfx')

const json = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const listRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/uploaded-sfx',
  tags: ['sfx'],
  summary: '作品の取り込んだ効果音（新しい順）',
  request: { params: ProjectParams },
  responses: { 200: json('取り込んだ効果音', successResponse(z.array(UploadedSfxResponse))), 404: errorContent('作品が無い') },
})
const uploadRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/uploaded-sfx',
  tags: ['sfx'],
  summary: '上げた音の素材を作品の効果音として記す（段には置かない）',
  request: { params: ProjectParams, body: { required: true, content: { 'application/json': { schema: UploadBody } } } },
  responses: {
    201: json('記した', successResponse(UploadedSfxResponse)),
    404: errorContent('作品が無い'),
    422: errorContent('入力の誤り・音の素材でない'),
  },
})

export type UploadedSfxRoutesDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  readonly uploadedSfx: UploadedSfxRepository
}

const toResponse = (sound: UploadedSfx) => ({
  id: sound.id,
  mediaAssetId: sound.mediaAssetId,
  title: sound.title,
  createdAt: sound.createdAt.toISOString(),
})

export const uploadedSfxRoutes = (deps: UploadedSfxRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const sounds = await deps.uploadedSfx.findByProject(projectId)
      return c.json(ok(sounds.map(toResponse)), 200)
    })
    .openapi(uploadRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.findById(projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const input = c.req.valid('json')
      // 別のワークスペース・別の作品の素材は「無い」と同じに扱う（保管庫はワークスペース単位）。
      const asset = await deps.mediaAssets.findById(input.mediaAssetId)
      const usable =
        asset !== null && asset.workspaceId === project.workspaceId && (asset.projectId ?? projectId) === projectId
      if (asset === null || !usable) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { mediaAssetId: [MISSING_SFX_ASSET_MESSAGE] }), 422)
      }
      if (asset.kind !== 'audio') {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { mediaAssetId: [NOT_AUDIO_SFX_MESSAGE] }), 422)
      }
      const created = await deps.uploadedSfx.create({ projectId, mediaAssetId: asset.id, title: input.title })
      return c.json(ok(toResponse(created)), 201)
    })
