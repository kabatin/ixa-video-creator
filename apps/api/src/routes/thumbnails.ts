import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ThumbnailRepository } from '@ixa/db'
import {
  MediaAssetId as MediaAssetIdSchema,
  ProjectId as ProjectIdSchema,
  ThumbnailId as ThumbnailIdSchema,
  ThumbnailSpec as ThumbnailSpecSchema,
  ThumbnailStatus as ThumbnailStatusSchema,
  thumbnailExportFileName,
  type Project,
  type Thumbnail,
  type ThumbnailId,
  type ThumbnailJobData,
  type ThumbnailSpec,
  type TimelineDocument,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'
import { loadTimelineDocument, type TimelineRoutesDeps } from './timeline.js'

/**
 * YouTube のサムネイルを書き出す口（ADR-0051）。**行を 1 つ作って thumbnail キューへ入れるだけ。** 描くのは worker。
 *
 * 背景がタイムラインのコマなら、書き出しの口（renders.ts）と同じ `loadTimelineDocument` で文書を組み、
 * **ジョブの中身でだけ**渡す。文書には署名付き URL が入るので、行（`spec`）には秒しか書かない（規約 7）。
 * 状態は画面・MCP が `GET /thumbnails/{id}` を引き直して追う（動画の書き出しと同じ。出来事は流さない）。
 */

/** キュー名は apps/worker/src/queues.ts の QUEUE_NAMES と一致させること（apps 同士は import できない）。 */
export const THUMBNAIL_QUEUE_NAME = 'thumbnail'

/** サムネイルのジョブをキューへ入れる口。Redis への依存を main.ts に閉じ込める。 */
export type ThumbnailQueue = { readonly enqueue: (data: ThumbnailJobData) => Promise<void> }

export type ThumbnailRoutesDeps = TimelineRoutesDeps & {
  readonly thumbnails: ThumbnailRepository
  readonly thumbnailQueue: ThumbnailQueue
  /** ファイル名の日時を書く地域（書き出しフォルダと同じ。この Mac の時刻）。 */
  readonly timeZone: string
}

export const MISSING_IMAGE_MESSAGE = '背景の画像が見つかりません'
export const FOREIGN_IMAGE_MESSAGE = 'この作品の画像ではありません'
export const NOT_IMAGE_MESSAGE = '背景にできるのは画像だけです'
export const EMPTY_TIMELINE_MESSAGE = 'タイムラインに何も並んでいません'
export const OUTSIDE_TIMELINE_MESSAGE = 'タイムラインの長さを超えた位置です'
const ENQUEUE_FAILED_MESSAGE = 'サムネイルを描く順番に入れられませんでした。もう一度押してください。'

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})
const ThumbnailParams = z.object({ id: ThumbnailIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })

const CreateBody = z.object({ spec: ThumbnailSpecSchema }).openapi('CreateThumbnailInput')
const CreatedData = z.object({ thumbnailId: ThumbnailIdSchema }).openapi('CreateThumbnailResult')

export const ThumbnailResponse = z
  .object({
    id: ThumbnailIdSchema,
    projectId: ProjectIdSchema,
    spec: ThumbnailSpecSchema,
    status: ThumbnailStatusSchema,
    outputAssetId: MediaAssetIdSchema.nullable(),
    fileName: z.string(),
    error: z.string().nullable(),
    createdAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
  .openapi('Thumbnail')
export type ThumbnailResponse = z.infer<typeof ThumbnailResponse>

export const toThumbnailResponse = (thumbnail: Thumbnail): ThumbnailResponse => ({
  id: thumbnail.id,
  projectId: thumbnail.projectId,
  spec: thumbnail.spec,
  status: thumbnail.status,
  outputAssetId: thumbnail.outputAssetId,
  fileName: thumbnail.fileName,
  error: thumbnail.error,
  createdAt: thumbnail.createdAt.toISOString(),
  finishedAt: thumbnail.finishedAt === null ? null : thumbnail.finishedAt.toISOString(),
})

const commonErrors = {
  404: errorContent('対象が存在しない'),
  422: errorContent('入力の検証に失敗した'),
  500: errorContent('サーバ内部エラー'),
}

const createThumbnailRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/thumbnails',
  tags: ['thumbnails'],
  summary: 'サムネイル（1280×720 の JPEG）の書き出しを thumbnail キューへ入れる',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: CreateBody } } },
  },
  responses: {
    202: { description: '受け付けた', content: { 'application/json': { schema: successResponse(CreatedData) } } },
    ...commonErrors,
  },
})

const getThumbnailRoute = createRoute({
  method: 'get',
  path: '/thumbnails/{id}',
  tags: ['thumbnails'],
  summary: 'サムネイルの書き出しの状態',
  request: { params: ThumbnailParams },
  responses: {
    200: { description: 'Thumbnail', content: { 'application/json': { schema: successResponse(ThumbnailResponse) } } },
    ...commonErrors,
  },
})

const listThumbnailsRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/thumbnails',
  tags: ['thumbnails'],
  summary: 'Project のサムネイルの書き出し（新しい順）',
  request: { params: ProjectParams },
  responses: {
    200: { description: 'Thumbnail 一覧', content: { 'application/json': { schema: listResponse(ThumbnailResponse) } } },
    ...commonErrors,
  },
})

type Prepared =
  | { readonly kind: 'ok'; readonly timeline: TimelineDocument | null }
  | { readonly kind: 'invalid'; readonly field: string; readonly message: string }

/** 背景が使えるかを確かめ、タイムラインのコマなら書き出しと同じ口で文書を組む。 */
const prepareBackground = async (
  deps: ThumbnailRoutesDeps,
  project: Project,
  spec: ThumbnailSpec,
): Promise<Prepared> => {
  const { background } = spec
  if (background.kind === 'image') {
    const asset = await deps.mediaAssets.findById(background.mediaAssetId)
    const message =
      asset === null
        ? MISSING_IMAGE_MESSAGE
        : asset.projectId !== project.id
          ? FOREIGN_IMAGE_MESSAGE
          : asset.kind !== 'image'
            ? NOT_IMAGE_MESSAGE
            : null
    return message === null ? { kind: 'ok', timeline: null } : { kind: 'invalid', field: 'background', message }
  }
  const loaded = await loadTimelineDocument(deps, project.id)
  const document = loaded?.document ?? null
  if (document === null || document.durationSec <= 0) {
    return { kind: 'invalid', field: 'background', message: EMPTY_TIMELINE_MESSAGE }
  }
  if (background.atSec >= document.durationSec) {
    return { kind: 'invalid', field: 'background', message: OUTSIDE_TIMELINE_MESSAGE }
  }
  return { kind: 'ok', timeline: document }
}

/**
 * 行を作ってキューへ入れる。**入れ損ねたら失敗にしてから投げる。** 待っているまま残すと、
 * 画面は「描いています」のまま止まる（絵のジョブと同じ）。
 */
const enqueueOrFail = async (
  deps: ThumbnailRoutesDeps,
  thumbnailId: ThumbnailId,
  timeline: TimelineDocument | null,
): Promise<void> => {
  try {
    await deps.thumbnailQueue.enqueue({ thumbnailId, timeline })
  } catch (error) {
    await deps.thumbnails.markFailed(thumbnailId, ENQUEUE_FAILED_MESSAGE)
    throw new Error('thumbnail キューへ入れられませんでした', { cause: error })
  }
}

export const thumbnailRoutes = (deps: ThumbnailRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(createThumbnailRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.findById(projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const { spec } = c.req.valid('json')

      const prepared = await prepareBackground(deps, project, spec)
      if (prepared.kind === 'invalid') {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { [prepared.field]: [prepared.message] }), 422)
      }

      const createdAt = new Date()
      const thumbnail = await deps.thumbnails.create({
        projectId: project.id,
        spec,
        fileName: thumbnailExportFileName({ projectName: project.name, createdAt, timeZone: deps.timeZone }),
        createdAt,
      })
      await enqueueOrFail(deps, thumbnail.id, prepared.timeline)
      return c.json(ok({ thumbnailId: thumbnail.id }), 202)
    })
    .openapi(getThumbnailRoute, async (c) => {
      const found = await deps.thumbnails.findById(c.req.valid('param').id)
      if (found === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(toThumbnailResponse(found)), 200)
    })
    .openapi(listThumbnailsRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.findById(projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const found = await deps.thumbnails.findByProject(project.id)
      return c.json(okList(found.map(toThumbnailResponse)), 200)
    })
