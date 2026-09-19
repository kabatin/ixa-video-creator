import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  MediaAssetRepository,
  MusicAnalysisRepository,
  MusicTrackRepository,
  ProjectRepository,
} from '@ixa/db'
import {
  CreateMusicTrackInput as CreateMusicTrackInputSchema,
  MusicAnalysis as MusicAnalysisSchema,
  MusicTrack as MusicTrackSchema,
  MusicTrackId as MusicTrackIdSchema,
  ProjectId as ProjectIdSchema,
  UpdateMusicTrackPatch as UpdateMusicTrackPatchSchema,
  type MusicAnalysis,
  type MusicTrack,
  type MusicTrackId,
  type ProjectId,
} from '@ixa/domain'
import type { ObjectStorage } from '@ixa/storage'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'

/**
 * 楽曲の登録と音楽解析の起動・参照（ADR-0009 / docs/ARCHITECTURE.md §15）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 *
 * 解析そのものは worker が行う。ここは**キューに積むところまで**で、
 * 結果を待たない（librosa の解析は数十秒かかるため HTTP を占有しない）。
 */

/** BullMQ のキュー名（docs/ARCHITECTURE.md §20）。apps 同士を import しないため定数で持つ。 */
export const ANALYSIS_QUEUE_NAME = 'analysis'

/** 波形ピークの署名付き URL の既定有効期限。UI が描画し終えるまで持てば足りる。 */
export const DEFAULT_PEAKS_URL_EXPIRES_SEC = 300

export const MISSING_ASSET_MESSAGE = '指定された MediaAsset が存在しません'
export const NOT_AUDIO_MESSAGE = '音声以外の MediaAsset は楽曲として登録できません'
export const ANALYSIS_NOT_FOUND_MESSAGE = 'この楽曲はまだ解析されていません'

/** 解析ジョブをキューへ投入する Port。Redis への依存を main.ts に閉じ込める。 */
export type AnalysisQueue = {
  /** ジョブデータは ID のみ。実データは worker が DB から読む（ADR-0008）。 */
  enqueue(musicTrackId: MusicTrackId): Promise<void>
}

export const MusicTrackResponse = MusicTrackSchema.openapi('MusicTrack')

/**
 * API が返す MusicAnalysis。日時は ISO8601 文字列にし、
 * 波形ピークは**保存済みのキーではなく都度発行した URL**で返す（CLAUDE.md 規約 7）。
 */
export const MusicAnalysisResponse = MusicAnalysisSchema.omit({
  createdAt: true,
  waveformPeaksKey: true,
})
  .extend({
    createdAt: z.string().datetime(),
    waveformPeaksUrl: z.string().min(1).openapi({ description: '都度発行する署名付き GET URL' }),
    waveformPeaksUrlExpiresInSec: z.number().int().positive(),
  })
  .openapi('MusicAnalysis')
export type MusicAnalysisResponse = z.infer<typeof MusicAnalysisResponse>

/**
 * `waveformPeaksKey` はスキーマが未知キーとして落とす。
 * 手で除くより、**返す形をスキーマ 1 箇所で決める**ほうが取りこぼしが起きない。
 */
const toAnalysisResponse = (
  analysis: MusicAnalysis,
  waveformPeaksUrl: string,
  expiresInSec: number,
): MusicAnalysisResponse =>
  MusicAnalysisResponse.parse({
    ...analysis,
    createdAt: analysis.createdAt.toISOString(),
    waveformPeaksUrl,
    waveformPeaksUrlExpiresInSec: expiresInSec,
  })

/** projectId は経路が持つので本文には含めない。正が 2 つになるのを避ける。 */
const CreateMusicTrackBody = CreateMusicTrackInputSchema.omit({ projectId: true }).openapi(
  'CreateMusicTrackInput',
)

const AnalysisAccepted = z
  .object({
    musicTrackId: MusicTrackIdSchema,
    /** 冪等。解析済みでもキューには積む（skip 判定は worker が行う）。 */
    queued: z.boolean(),
  })
  .openapi('AnalysisAccepted')

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})
const MusicTrackParams = z.object({
  id: MusicTrackIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
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

const listMusicTracksRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/music-tracks',
  tags: ['music'],
  summary: 'Project の楽曲一覧',
  request: { params: ProjectParams },
  responses: {
    200: jsonContent('楽曲一覧', listResponse(MusicTrackResponse)),
    ...commonErrors,
  },
})

const createMusicTrackRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/music-tracks',
  tags: ['music'],
  summary: '楽曲を登録する',
  request: { params: ProjectParams, body: body(CreateMusicTrackBody) },
  responses: {
    201: jsonContent('登録された楽曲', successResponse(MusicTrackResponse)),
    ...commonErrors,
  },
})

const UpdateMusicTrackBody = UpdateMusicTrackPatchSchema.openapi('UpdateMusicTrackInput')

const updateMusicTrackRoute = createRoute({
  method: 'patch',
  path: '/music-tracks/{id}',
  tags: ['music'],
  summary: '楽曲の題名・オフセット・音量を直す（マスターは set-master で変える）',
  request: { params: MusicTrackParams, body: body(UpdateMusicTrackBody) },
  responses: {
    200: jsonContent('更新後の楽曲', successResponse(MusicTrackResponse)),
    ...commonErrors,
  },
})

const setMasterRoute = createRoute({
  method: 'post',
  path: '/music-tracks/{id}/set-master',
  tags: ['music'],
  summary: 'この楽曲をマスターにする（同じ Project の他の楽曲は降格する）',
  request: { params: MusicTrackParams },
  responses: {
    200: jsonContent('Project の楽曲一覧（付け替え後）', listResponse(MusicTrackResponse)),
    ...commonErrors,
  },
})

const deleteMusicTrackRoute = createRoute({
  method: 'delete',
  path: '/music-tracks/{id}',
  tags: ['music'],
  summary: '楽曲をソフトデリートする。マスターを消したら残りの最古をマスターにする',
  request: { params: MusicTrackParams },
  responses: { 204: { description: '削除した（本文なし）' }, ...commonErrors },
})

const requestAnalysisRoute = createRoute({
  method: 'post',
  path: '/music-tracks/{id}/analysis',
  tags: ['music'],
  summary: '音楽解析をキューへ投入する（結果は待たない）',
  request: { params: MusicTrackParams },
  responses: {
    202: jsonContent('解析を受け付けた', successResponse(AnalysisAccepted)),
    ...commonErrors,
  },
})

const getAnalysisRoute = createRoute({
  method: 'get',
  path: '/music-tracks/{id}/analysis',
  tags: ['music'],
  summary: '最新の解析結果を取得する',
  request: { params: MusicTrackParams },
  responses: {
    200: jsonContent('解析結果', successResponse(MusicAnalysisResponse)),
    ...commonErrors,
  },
})

export type MusicRoutesDeps = {
  musicTracks: MusicTrackRepository
  musicAnalyses: MusicAnalysisRepository
  /** Project の実在確認だけに使う。 */
  projects: ProjectRepository
  /** 登録しようとしている音源の実在と種別の確認に使う。 */
  mediaAssets: Pick<MediaAssetRepository, 'findById'>
  storage: ObjectStorage
  queue: AnalysisQueue
}

export const musicRoutes = (deps: MusicRoutesDeps) => {
  const projectMissing = async (projectId: ProjectId): Promise<boolean> =>
    (await deps.projects.findById(projectId)) === null

  const findTrack = (id: MusicTrackId): Promise<MusicTrack | null> => deps.musicTracks.findById(id)

  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listMusicTracksRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if (await projectMissing(projectId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(okList(await deps.musicTracks.findByProject(projectId)), 200)
    })
    .openapi(createMusicTrackRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if (await projectMissing(projectId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const input = c.req.valid('json')

      /**
       * 音源の実在と種別をここで弾く。
       * 解析は worker まで行ってから落ちるため、**登録時に気付けないと原因が遠くなる**。
       */
      const asset = await deps.mediaAssets.findById(input.mediaAssetId)
      if (asset === null) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { mediaAssetId: [MISSING_ASSET_MESSAGE] }),
          422,
        )
      }
      if (asset.kind !== 'audio') {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { mediaAssetId: [NOT_AUDIO_MESSAGE] }), 422)
      }

      const created = await deps.musicTracks.create({ ...input, projectId })
      return c.json(ok(created), 201)
    })
    .openapi(updateMusicTrackRoute, async (c) => {
      const updated = await deps.musicTracks.update(c.req.valid('param').id, c.req.valid('json'))
      if (updated === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(updated), 200)
    })
    .openapi(setMasterRoute, async (c) => {
      const updated = await deps.musicTracks.setMaster(c.req.valid('param').id)
      if (updated === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      // 降格した側も画面が持ち直せるよう、Project の全曲を返す。
      return c.json(okList(await deps.musicTracks.findByProject(updated.projectId)), 200)
    })
    .openapi(deleteMusicTrackRoute, async (c) => {
      const removed = await deps.musicTracks.softDelete(c.req.valid('param').id)
      if (!removed) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.body(null, 204)
    })
    .openapi(requestAnalysisRoute, async (c) => {
      const { id } = c.req.valid('param')
      if ((await findTrack(id)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      /**
       * 解析済みかどうかはここでは見ない。冪等判定は worker が持つ（`skipReason`）。
       * API 側にも同じ判定を置くと、**手動補正の優先規則が 2 箇所に散る**ため。
       */
      await deps.queue.enqueue(id)
      return c.json(ok({ musicTrackId: id, queued: true }), 202)
    })
    .openapi(getAnalysisRoute, async (c) => {
      const { id } = c.req.valid('param')
      if ((await findTrack(id)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const analysis = await deps.musicAnalyses.findByTrack(id)
      if (analysis === null) return c.json(fail(ANALYSIS_NOT_FOUND_MESSAGE), 404)

      const url = await deps.storage.signedGetUrl(
        analysis.waveformPeaksKey,
        DEFAULT_PEAKS_URL_EXPIRES_SEC,
      )
      return c.json(ok(toAnalysisResponse(analysis, url, DEFAULT_PEAKS_URL_EXPIRES_SEC)), 200)
    })
}
