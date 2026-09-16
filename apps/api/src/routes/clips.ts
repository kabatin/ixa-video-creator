import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { MediaAssetRepository, ProjectRepository, TimelineClipRepository } from '@ixa/db'
import {
  CreateTimelineClipInput as CreateTimelineClipInputSchema,
  ProjectId as ProjectIdSchema,
  TimelineClip as TimelineClipSchema,
  TimelineClipId as TimelineClipIdSchema,
  TimelineTrack as TimelineTrackSchema,
  UpdateTimelineClipPatch as UpdateTimelineClipPatchSchema,
  type ProjectId,
  type TimelineClip,
  type TimelineClipContent,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import {
  errorContent,
  fail,
  listResponse,
  ok,
  okList,
  successResponse,
  type FieldErrors,
} from '../response.js'

/**
 * VIDEO1 以外のトラックに載る `TimelineClip` の CRUD（docs/DOMAIN.md §12）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 *
 * VIDEO1 は Shot の投影であり TimelineClip を持たない（ADR-0002）。
 * そのため `TimelineTrack` の enum にも VIDEO1 は無く、指定すると検証で落ちる。
 */

/** 選べるトラックは Domain の enum が唯一の正。ここで列挙し直さない。 */
const TRACK_OPTIONS = TimelineTrackSchema.options

export const INVALID_TRACK_MESSAGE =
  `track に指定できるのは ${TRACK_OPTIONS.join(' / ')} です。` +
  'VIDEO1 は Shot の投影なので TimelineClip を持ちません（ADR-0002）'

export const MISSING_ASSET_MESSAGE = '指定された MediaAsset が存在しません'
export const INVALID_TRIM_RANGE_MESSAGE = 'inSec は outSec より小さい必要があります'
/**
 * トリム範囲と配置尺の食い違いを弾く。
 *
 * **レンダラは `outSec` を読まない。** `inSec` を `startFrom` にして
 * `durationSec` の長さだけ再生する（`packages/render/src/compositions/Timeline.tsx`）。
 * つまり食い違ったまま保存できると、画面で指定した終点が黙って無視される。
 * 速度変更は実装していないので、食い違いに正しい解釈は存在しない。
 */
export const TRIM_LENGTH_MISMATCH_MESSAGE =
  'トリムの長さ（outSec − inSec）と配置する尺（durationSec）を一致させてください'
/**
 * 部分更新でトリムだけ変えると、長さの整合を確かめる相手（durationSec）が無い。
 * リポジトリに findById が無いため既存値を読めず、**検証が素通りする**。
 * 素通りさせると、更新経由でだけ食い違った行が作れてしまう。
 * 両方まとめて送らせる。
 */
export const TRIM_NEEDS_DURATION_MESSAGE =
  'トリム（content）を変えるときは durationSec も一緒に送ってください'

/**
 * 秒の比較許容誤差。`@ixa/timeline` の TIME_EPSILON と同じ値だが、
 * index から公開されていないため同じ値を置く。
 */
const TIME_EPSILON = 1e-6
export const NON_POSITIVE_DURATION_MESSAGE = 'durationSec は 0 より大きい必要があります'

/**
 * Domain の enum に「なぜ弾かれるか」が伝わるメッセージだけを足したもの。
 * 値の集合は `TimelineTrackSchema.options` から取るので、両者がずれることはない。
 */
const TrackSchema = z.enum(TRACK_OPTIONS, { errorMap: () => ({ message: INVALID_TRACK_MESSAGE }) })

/** 日時は ISO8601 文字列で返す（他のルートと揃える）。 */
export const TimelineClipResponse = TimelineClipSchema.omit({ createdAt: true })
  .extend({ createdAt: z.string().datetime() })
  .openapi('TimelineClip')
export type TimelineClipResponse = z.infer<typeof TimelineClipResponse>

const toClipResponse = (clip: TimelineClip): TimelineClipResponse => ({
  ...clip,
  createdAt: clip.createdAt.toISOString(),
})

/** projectId は経路が持つので本文には含めない。正が 2 つになるのを避ける。 */
const CreateClipBody = CreateTimelineClipInputSchema.omit({ projectId: true })
  .extend({ track: TrackSchema })
  .openapi('CreateTimelineClipInput')

const UpdateClipBody = UpdateTimelineClipPatchSchema.extend({
  track: TrackSchema.optional(),
}).openapi('UpdateTimelineClipPatch')

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})
const ClipParams = z.object({
  id: TimelineClipIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})

/**
 * 絞り込みは任意。**未指定なら全件、未知の値なら 422** であって、
 * 「知らない値は無視して全件」にはしない。
 * 黙って無視すると、呼び出し側は絞り込まれた結果だと信じて全件を読んでしまう。
 */
const ListClipsQuery = z.object({
  track: TrackSchema.optional().openapi({ param: { name: 'track', in: 'query', required: false } }),
})

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const body = <T extends z.ZodTypeAny>(schema: T) => ({
  required: true as const,
  content: { 'application/json': { schema } },
})

const commonErrors = {
  404: errorContent('対象が存在しない'),
  422: errorContent('入力の検証に失敗した'),
  500: errorContent('サーバ内部エラー'),
}

const listClipsRoute = createRoute({
  method: 'get', path: '/projects/{projectId}/clips', tags: ['clips'],
  summary: 'Project の TimelineClip 一覧（投入順）',
  request: { params: ProjectParams, query: ListClipsQuery },
  responses: {
    200: jsonContent('TimelineClip 一覧', listResponse(TimelineClipResponse)),
    ...commonErrors,
  },
})

const createClipRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/clips', tags: ['clips'],
  summary: 'TimelineClip を作成する',
  request: { params: ProjectParams, body: body(CreateClipBody) },
  responses: {
    201: jsonContent('作成された TimelineClip', successResponse(TimelineClipResponse)),
    ...commonErrors,
  },
})

const updateClipRoute = createRoute({
  method: 'patch', path: '/clips/{id}', tags: ['clips'],
  summary: 'TimelineClip を部分更新する',
  request: { params: ClipParams, body: body(UpdateClipBody) },
  responses: {
    200: jsonContent('更新後の TimelineClip', successResponse(TimelineClipResponse)),
    ...commonErrors,
  },
})

const deleteClipRoute = createRoute({
  method: 'delete', path: '/clips/{id}', tags: ['clips'],
  summary: 'TimelineClip をソフトデリートする',
  request: { params: ClipParams },
  responses: { 204: { description: '削除した（本文なし）' }, ...commonErrors },
})

/**
 * 参照先を見ずに値だけで決まる検証。create と patch で同じ規則を使う。
 *
 * PATCH で省略された項目を検証しないのは、**省略時に既存値がそのまま残る**ため。
 * 既存値は自身が書かれた時点でこの関数を通っている。
 * `content` は部分マージではなくバリアントごと差し替わるので、
 * 差し替えるたびに必ず全体を検証できる（`UpdateTimelineClipPatch` の `content` は partial にならない）。
 */
export const clipShapeErrors = (input: {
  readonly durationSec?: number
  readonly content?: TimelineClipContent
}): FieldErrors | null => {
  const durationError: FieldErrors =
    input.durationSec !== undefined && input.durationSec <= 0
      ? { durationSec: [NON_POSITIVE_DURATION_MESSAGE] }
      : {}

  const trimError: FieldErrors =
    input.content?.type === 'media' && input.content.inSec >= input.content.outSec
      ? { 'content.inSec': [INVALID_TRIM_RANGE_MESSAGE] }
      : {}

  /**
   * 範囲が壊れている（in >= out）ときは長さを比べても意味が無いので、
   * そちらのメッセージだけを返す。2 つ出すと直す順番が分からない。
   */
  const lengthError: FieldErrors =
    input.content?.type === 'media' &&
    input.content.inSec < input.content.outSec &&
    input.durationSec !== undefined &&
    input.durationSec > 0 &&
    Math.abs(input.content.outSec - input.content.inSec - input.durationSec) > TIME_EPSILON
      ? { durationSec: [TRIM_LENGTH_MISMATCH_MESSAGE] }
      : {}

  const fields: FieldErrors = { ...durationError, ...trimError, ...lengthError }
  return Object.keys(fields).length === 0 ? null : fields
}

export type ClipRoutesDeps = {
  timelineClips: TimelineClipRepository
  /** Project の実在確認だけに使う。 */
  projects: ProjectRepository
  /** media クリップが指す素材の実在確認だけに使う。 */
  mediaAssets: Pick<MediaAssetRepository, 'findById'>
}

export const clipRoutes = (deps: ClipRoutesDeps) => {
  const projectMissing = async (projectId: ProjectId): Promise<boolean> =>
    (await deps.projects.findById(projectId)) === null

  /**
   * media クリップの参照先を確認する。
   * 存在しない素材を許すと、レンダリング時に `unresolved` として絵に出るまで気付けない。
   */
  const missingAssetErrors = async (
    content: TimelineClipContent | undefined,
  ): Promise<FieldErrors | null> => {
    if (content === undefined || content.type !== 'media') return null
    const asset = await deps.mediaAssets.findById(content.mediaAssetId)
    return asset === null ? { 'content.mediaAssetId': [MISSING_ASSET_MESSAGE] } : null
  }

  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listClipsRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if (await projectMissing(projectId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const { track } = c.req.valid('query')
      const found = await deps.timelineClips.findByProject(projectId)
      const filtered = track === undefined ? found : found.filter((clip) => clip.track === track)
      return c.json(okList(filtered.map(toClipResponse)), 200)
    })
    .openapi(createClipRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if (await projectMissing(projectId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const input = c.req.valid('json')
      const shape = clipShapeErrors(input)
      if (shape !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, shape), 422)

      const missing = await missingAssetErrors(input.content)
      if (missing !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, missing), 422)

      const created = await deps.timelineClips.create({ ...input, projectId })
      return c.json(ok(toClipResponse(created)), 201)
    })
    .openapi(updateClipRoute, async (c) => {
      const patch = c.req.valid('json')

      /**
       * 値そのものの壊れ（in >= out、尺 0）を先に見る。
       * 「尺も一緒に送って」より、範囲が壊れていることのほうが根本的で、
       * 先に伝えないと直す順番が分からない。
       */
      const shape = clipShapeErrors(patch)
      if (shape !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, shape), 422)

      // media のトリムだけを送られると長さを比べる相手が無い。作成時と同じ検証を通せるようにする。
      if (patch.content?.type === 'media' && patch.durationSec === undefined) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { durationSec: [TRIM_NEEDS_DURATION_MESSAGE] }),
          422,
        )
      }

      const missing = await missingAssetErrors(patch.content)
      if (missing !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, missing), 422)

      /**
       * 存在しなければリポジトリが DbNotFoundError を投げ、共通ハンドラが 404 にする。
       * ここで catch しないのは意図的で、畳んでよい既知の失敗が他に無いため。
       */
      const updated = await deps.timelineClips.update(c.req.valid('param').id, patch)
      return c.json(ok(toClipResponse(updated)), 200)
    })
    .openapi(deleteClipRoute, async (c) => {
      await deps.timelineClips.softDelete(c.req.valid('param').id)
      return c.body(null, 204)
    })
}
