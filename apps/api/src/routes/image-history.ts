import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { retryImageJobInput, type CharacterRepository, type ImageCheckRepository, type ImageJobRepository, type ShotReferenceRepository, type ShotRepository } from '@ixa/db'
import {
  CharacterId as CharacterIdSchema,
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  ImageGenerationJobStatus as ImageGenerationJobStatusSchema,
  MediaAssetId as MediaAssetIdSchema,
  ShotId as ShotIdSchema,
  type ImageCheck,
  type ImageGenerationJob,
} from '@ixa/domain'
import { manualStartFrameOf } from '@ixa/generation'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'
import { ImageCheckSummary, toImageCheckSummary } from './image-check-wire.js'
import { ImagePromptFields, imagePromptFieldsOf } from './image-prompt-wire.js'
import { startImageJob, type ImageJobStartDeps } from './image-job-start.js'

/**
 * 作った絵の履歴と、人が押すやり直し（ADR-0055 §9）。
 * - 開始フレームの履歴: 作った順の絵・チェックの結果・当てたか・いま付いているか。選び直しは既存の
 *   `PUT /shots/{id}/start-frame`（取り消しの記録がある）
 * - 識別画像のチェックの印: キャラクターシートとして作った絵だけに付く
 * - やり直す: 利用枠を使う AI で自動ではやり直さないとき、人が押す。同じ AI で、つながりに足す
 */

export type ImageHistoryRoutesDeps = ImageJobStartDeps & {
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly characters: Pick<CharacterRepository, 'findById' | 'listIdentityImages'>
  readonly shotReferences: Pick<ShotReferenceRepository, 'findByShot'>
  readonly imageJobs: Pick<
    ImageJobRepository,
    | 'create'
    | 'markFailed'
    | 'findById'
    | 'findByShot'
    | 'findByMediaAssetIds'
    | 'findActiveByShot'
    | 'findActiveByCharacter'
    | 'findRetryOf'
  >
  readonly imageChecks: Pick<ImageCheckRepository, 'findByJobIds'>
  /** 自動のやり直しの上限（`IMAGE_CHECK_MAX_RETRIES`）。画面の「やり直し 1/2」に使う。 */
  readonly maxRetries: number
}

export const BUSY_MESSAGE = 'この絵を作っている最中です。できあがるまで待ってください。'
export const NOT_DRAWN_MESSAGE = 'この絵はまだできていないため、やり直せません。'
export const ALREADY_RETRIED_MESSAGE = 'この絵はもうやり直しました。新しい方の絵からやり直してください。'

const pathId = <T extends z.ZodTypeAny>(schema: T) => z.object({ id: schema.openapi({ param: { name: 'id', in: 'path' } }) })

export const ImageHistoryEntry = z
  .object({
    jobId: ImageGenerationJobIdSchema,
    status: ImageGenerationJobStatusSchema,
    /** 何枚目の試しか（1 から）。 */
    attempt: z.number().int(),
    /** やり直しなら前のジョブ。 */
    retryOfJobId: ImageGenerationJobIdSchema.nullable(),
    /** できた絵。できていなければ null。 */
    mediaAssetId: MediaAssetIdSchema.nullable(),
    /** つながりの最後に当てた絵か。 */
    applied: z.boolean(),
    /** いま開始フレームに付いている絵か。 */
    current: z.boolean(),
    check: ImageCheckSummary.nullable(),
    /** 失敗したときの理由（利用者にそのまま見せる文）。 */
    error: z.string().nullable(),
    queuedAt: z.string().datetime(),
    ...ImagePromptFields,
  })
  .openapi('ImageHistoryEntry')
export type ImageHistoryEntry = z.infer<typeof ImageHistoryEntry>

const HistoryData = z
  .object({ items: z.array(ImageHistoryEntry), maxRetries: z.number().int() })
  .openapi('StartFrameHistory')

const IdentityCheck = z
  .object({ mediaAssetId: MediaAssetIdSchema, jobId: ImageGenerationJobIdSchema, check: ImageCheckSummary.nullable() })
  .openapi('IdentityImageCheck')

const RetryStarted = z.object({ jobId: ImageGenerationJobIdSchema }).openapi('ImageRetryStarted')

const historyRoute = createRoute({
  method: 'get',
  path: '/shots/{id}/start-frame/history',
  tags: ['shots'],
  summary: 'Shot の開始フレームとして作った絵の履歴（新しい順）',
  request: { params: pathId(ShotIdSchema) },
  responses: {
    200: { description: '履歴', content: { 'application/json': { schema: successResponse(HistoryData) } } },
    404: errorContent('Shot が存在しない'),
    500: errorContent('サーバ内部エラー'),
  },
})

const identityChecksRoute = createRoute({
  method: 'get',
  path: '/characters/{id}/identity-images/checks',
  tags: ['characters'],
  summary: 'キャラクターシートとして作った識別画像のチェックの結果',
  request: { params: pathId(CharacterIdSchema) },
  responses: {
    200: { description: 'チェックの結果', content: { 'application/json': { schema: listResponse(IdentityCheck) } } },
    404: errorContent('キャラクターが存在しない'),
    500: errorContent('サーバ内部エラー'),
  },
})

const retryRoute = createRoute({
  method: 'post',
  path: '/image-jobs/{id}/retry',
  tags: ['shots'],
  summary: '作った絵をやり直す（同じ AI で、やり直しのつながりに足す）',
  request: { params: pathId(ImageGenerationJobIdSchema) },
  responses: {
    202: { description: 'やり直し始めた', content: { 'application/json': { schema: successResponse(RetryStarted) } } },
    404: errorContent('ジョブが存在しない'),
    409: errorContent('同じ Shot・キャラクターの絵を作っている最中'),
    422: errorContent('まだ絵ができていない'),
    500: errorContent('サーバ内部エラー'),
  },
})

const checkOf = (checks: readonly ImageCheck[], job: ImageGenerationJob): ImageCheck | null =>
  checks.find((check) => check.imageJobId === job.id) ?? null

export const toHistoryEntry = (
  job: ImageGenerationJob,
  check: ImageCheck | null,
  currentMediaAssetId: string | null,
): ImageHistoryEntry => ({
  jobId: job.id,
  status: job.status,
  attempt: job.attempt,
  retryOfJobId: job.retryOfJobId,
  mediaAssetId: job.mediaAssetId,
  applied: job.appliedAt !== null,
  current: job.mediaAssetId !== null && job.mediaAssetId === currentMediaAssetId,
  check: toImageCheckSummary(check),
  error: job.error?.message ?? null,
  queuedAt: job.queuedAt.toISOString(),
  ...imagePromptFieldsOf(job),
})

/** 同じ持ち主で作っている最中か（重ねて頼ませない）。 */
const isBusy = async (deps: ImageHistoryRoutesDeps, job: ImageGenerationJob): Promise<boolean> => {
  if (job.shotId !== null) return (await deps.imageJobs.findActiveByShot(job.shotId)) !== null
  if (job.characterId !== null) return (await deps.imageJobs.findActiveByCharacter(job.characterId)) !== null
  return false
}

export const imageHistoryRoutes = (deps: ImageHistoryRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(historyRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const [jobs, current] = await Promise.all([deps.imageJobs.findByShot(shot.id), manualStartFrameOf(deps.shotReferences, shot.id)])
      const checks = await deps.imageChecks.findByJobIds(jobs.map((job) => job.id))
      const items = jobs.map((job) => toHistoryEntry(job, checkOf(checks, job), current))
      return c.json(ok({ items, maxRetries: deps.maxRetries }), 200)
    })
    .openapi(identityChecksRoute, async (c) => {
      const character = await deps.characters.findById(c.req.valid('param').id)
      if (character === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const images = await deps.characters.listIdentityImages(character.id)
      const jobs = (await deps.imageJobs.findByMediaAssetIds(images.map((image) => image.mediaAssetId))).filter(
        (job) => job.kind === 'character_sheet' && job.characterId === character.id,
      )
      const checks = await deps.imageChecks.findByJobIds(jobs.map((job) => job.id))
      const items = jobs.flatMap((job) =>
        job.mediaAssetId === null
          ? []
          : [{ mediaAssetId: job.mediaAssetId, jobId: job.id, check: toImageCheckSummary(checkOf(checks, job)) }],
      )
      return c.json(okList(items), 200)
    })
    .openapi(retryRoute, async (c) => {
      const job = await deps.imageJobs.findById(c.req.valid('param').id)
      if (job === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      if (job.status !== 'succeeded' || job.mediaAssetId === null) return c.json(fail(NOT_DRAWN_MESSAGE), 422)
      if (await isBusy(deps, job)) return c.json(fail(BUSY_MESSAGE), 409)
      // 1 つの絵のやり直しは 1 つだけ（DB の一意インデックス）。キーアートは持ち主の Shot が無いので、ここで連打を止める。
      const retried = await deps.imageJobs.findRetryOf(job.id)
      if (retried !== null) {
        const active = retried.status === 'queued' || retried.status === 'running' || retried.status === 'checking'
        return c.json(fail(active ? BUSY_MESSAGE : ALREADY_RETRIED_MESSAGE), 409)
      }
      const retry = await startImageJob(deps, retryImageJobInput(job))
      return c.json(ok({ jobId: retry.id }), 202)
    })
