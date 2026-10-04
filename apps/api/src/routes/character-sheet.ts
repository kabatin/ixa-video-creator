import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { CharacterRepository, ImageJobRepository } from '@ixa/db'
import {
  CharacterId as CharacterIdSchema,
  CharacterIdentityImageId as CharacterIdentityImageIdSchema,
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  ImageGenerationJobStatus as ImageGenerationJobStatusSchema,
  pickSheetReference,
  type ModelId,
  type ProviderId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { startImageJob, type ImageJobStartDeps } from './image-job-start.js'

/**
 * 1 枚の画像からキャラクターシート（四面図）を作る口（ADR-0035。制作者 2026-10-03「動画生成に役立つ形式の
 * キャラクターシートを 1 枚の画像から作れるといい。正面などの画像を用意したら、それを基に Codex CLI で作る」）。
 *
 * **ジョブを 1 行作って image キューへ入れるだけ。** 作るのは worker（Codex は 1 度に 1 枚なので、絵コンテの画像と同じ
 * 順番待ち）。できたシートは識別画像の四面図に足され、動画・絵コンテの参照で優先して使われる。
 */

export type CharacterSheetRoutesDeps = ImageJobStartDeps & {
  readonly characters: Pick<CharacterRepository, 'findById' | 'listIdentityImages'>
  readonly imageJobs: Pick<ImageJobRepository, 'create' | 'markFailed' | 'findActiveByCharacter' | 'findLatestByCharacter'>
  /** どの口で作るか。**作るたびに呼ぶ**（「使う AI」の画像の欄。ADR-0032）。 */
  readonly imageModel: () => Promise<{ readonly providerId: ProviderId; readonly modelId: ModelId }>
}

export const DRAWING_SHEET_MESSAGE = 'このキャラクターのシートを作っています。できあがるまで待ってください。'
const NO_REFERENCE_MESSAGE = '手本にする画像がありません。正面などの画像を落としてから作ってください（キャラクターシートは手本にできません）'
const UNUSABLE_REFERENCE_MESSAGE = 'その画像は手本にできません（このキャラクターの、キャラクターシート以外の画像を選んでください）'

const CharacterParams = z.object({ id: CharacterIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })
const SheetBody = z
  .object({
    /** 手本にする識別画像。省略すると、キャラクターシート以外の主の画像（無ければ最初の 1 枚）。 */
    referenceIdentityImageId: CharacterIdentityImageIdSchema.optional(),
  })
  .openapi('CharacterSheetInput')
const StartedData = z.object({ jobId: ImageGenerationJobIdSchema }).openapi('CharacterSheetStarted')
/** 直近のジョブ。**開き直しても**「作っています」「作れませんでした: 理由」を出せる（出来事を取り逃しても分かる）。 */
const SheetState = z
  .object({
    job: z
      .object({
        id: ImageGenerationJobIdSchema,
        status: ImageGenerationJobStatusSchema,
        /** 失敗したときの理由（利用者にそのまま見せる文）。 */
        error: z.string().nullable(),
      })
      .nullable(),
  })
  .openapi('CharacterSheetState')

const startRoute = createRoute({
  method: 'post',
  path: '/characters/{id}/character-sheet',
  tags: ['characters'],
  summary: '手本の画像 1 枚からキャラクターシート（四面図）を作り始める',
  request: { params: CharacterParams, body: { required: true, content: { 'application/json': { schema: SheetBody } } } },
  responses: {
    202: { description: '作り始めた', content: { 'application/json': { schema: successResponse(StartedData) } } },
    404: errorContent('キャラクターが存在しない'),
    409: errorContent('このキャラクターのシートを作っている最中'),
    422: errorContent('手本にする画像が無い・使えない'),
    500: errorContent('サーバ内部エラー'),
  },
})

const stateRoute = createRoute({
  method: 'get',
  path: '/characters/{id}/character-sheet',
  tags: ['characters'],
  summary: 'キャラクターシートを作る直近のジョブの状態',
  request: { params: CharacterParams },
  responses: {
    200: { description: '直近のジョブ', content: { 'application/json': { schema: successResponse(SheetState) } } },
    404: errorContent('キャラクターが存在しない'),
    500: errorContent('サーバ内部エラー'),
  },
})

export const characterSheetRoutes = (deps: CharacterSheetRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(startRoute, async (c) => {
      const character = await deps.characters.findById(c.req.valid('param').id)
      if (character === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const { referenceIdentityImageId } = c.req.valid('json')
      const reference = pickSheetReference(await deps.characters.listIdentityImages(character.id), referenceIdentityImageId)
      if (reference === null) {
        const message = referenceIdentityImageId === undefined ? NO_REFERENCE_MESSAGE : UNUSABLE_REFERENCE_MESSAGE
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { referenceIdentityImageId: [message] }), 422)
      }
      if ((await deps.imageJobs.findActiveByCharacter(character.id)) !== null) {
        return c.json(fail(DRAWING_SHEET_MESSAGE), 409)
      }
      const job = await startImageJob(deps, {
        kind: 'character_sheet',
        projectId: character.projectId,
        characterId: character.id,
        referenceAssetIds: [reference.mediaAssetId],
        ...(await deps.imageModel()),
      })
      return c.json(ok({ jobId: job.id }), 202)
    })
    .openapi(stateRoute, async (c) => {
      const character = await deps.characters.findById(c.req.valid('param').id)
      if (character === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const latest = await deps.imageJobs.findLatestByCharacter(character.id)
      const job = latest === null ? null : { id: latest.id, status: latest.status, error: latest.error?.message ?? null }
      return c.json(ok({ job }), 200)
    })
