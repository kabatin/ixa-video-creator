import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { MediaAssetRepository, ProjectRepository, ShotRepository, TakeRepository } from '@ixa/db'
import {
  MediaAssetId as MediaAssetIdSchema,
  ModelId,
  ProviderId,
  ShotId as ShotIdSchema,
  compileSpec,
  computeSpecHash,
  settledShotStatus,
  type MediaAsset,
  type Project,
  type Shot,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import type { Logger } from '../logger.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { TakeResponse, publishShotStatus, toTakeResponse, type ShotRoutesDeps } from './shots.js'

/**
 * 手持ちの動画を Take にする（ADR-0026）。
 *
 * **アップロード済みの動画をそのまま Take の素材にする。** Provider を通して写すと
 * 同じ中身の素材が二重になり、`media_assets` の checksum の一意制約に当たる。
 * 再エンコードもしないので、何十本でもすぐ終わる。サムネイル・ポスター・最終フレームは
 * アップロードしたときの media の処理が作る。
 */

export type ShotTakeImportRoutesDeps = {
  readonly shots: Pick<ShotRepository, 'findById' | 'updateStatus'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  readonly takes: Pick<TakeRepository, 'create' | 'findByShot'>
  readonly events: ShotRoutesDeps['events']
  readonly logger: Logger
}

/** 持ち込んだ Take の Provider とモデル。費用メーターと Take カードはこれで見分ける。 */
export const IMPORT_PROVIDER_ID = ProviderId.parse('import')
export const IMPORT_MODEL_ID = ModelId.parse('import/footage')

const NOT_VIDEO_MESSAGE = '動画を指定してください（画像は「最初のフレーム」で付けます）'
const FOREIGN_ASSET_MESSAGE = 'この Project のワークスペースの動画ではありません'
const GENERATING_MESSAGE = '生成中の Shot には取り込めません。生成が終わってから取り込んでください'

const ShotParams = z.object({
  id: ShotIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})

const ImportTakeBody = z
  .object({
    mediaAssetId: MediaAssetIdSchema,
    /** どのモデルで作ったか。分からなければ null（推定なら「（推定）」と書く）。 */
    sourceModel: z.string().trim().min(1).max(120).nullable().default(null),
    /** 元のファイル名。素材の行には残らないので、ここで Take に残す。 */
    fileName: z.string().max(255).nullable().default(null),
  })
  .openapi('ImportTakeInput')

const importRoute = createRoute({
  method: 'post',
  path: '/shots/{id}/takes/import',
  tags: ['shots'],
  summary: '手持ちの動画を Take として取り込む（採用はしない）',
  request: {
    params: ShotParams,
    body: { required: true, content: { 'application/json': { schema: ImportTakeBody } } },
  },
  responses: {
    200: {
      description: 'この Shot に同じ動画の Take が既にある（増やさずにそれを返す）',
      content: { 'application/json': { schema: successResponse(TakeResponse) } },
    },
    201: {
      description: '取り込んだ Take',
      content: { 'application/json': { schema: successResponse(TakeResponse) } },
    },
    404: errorContent('Shot が存在しない'),
    409: errorContent('Shot が生成中'),
    422: errorContent('動画ではない / 別のワークスペースの素材'),
    500: errorContent('サーバ内部エラー'),
  },
})

const assetProblem = (asset: MediaAsset | null, project: Project): string | null => {
  if (asset === null || asset.workspaceId !== project.workspaceId) return FOREIGN_ASSET_MESSAGE
  return asset.kind === 'video' ? null : NOT_VIDEO_MESSAGE
}

/**
 * 持ち込みの仕様。**Shot の生成と同じ組み立て**を通し、種類だけ `existing_footage` にする。
 * 種類が違うので、同じ Shot を後で生成しても specHash は重ならない。
 * 尺は素材の長さ（まだ分からなければ Shot の尺）。
 */
const importSpec = (project: Project, shot: Shot, asset: MediaAsset) => {
  const durationSec = asset.probe?.durationSec ?? shot.durationSec
  return compileSpec({
    project,
    shot: {
      ...shot,
      sourceType: { type: 'existing_footage', mediaAssetId: asset.id, inSec: 0, outSec: durationSec },
    },
    characters: [],
    references: [],
    generationDurationSec: durationSec,
    seed: null,
    negativePrompt: null,
  })
}

export const shotTakeImportRoutes = (deps: ShotTakeImportRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(importRoute, async (c) => {
    const shot = await deps.shots.findById(c.req.valid('param').id)
    if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    const project = await deps.projects.findById(shot.projectId)
    if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    // 生成が終わったとき worker が状態を決め直す。ここで動かすと食い違う。
    if (shot.status === 'generating') return c.json(fail(GENERATING_MESSAGE), 409)

    const { mediaAssetId, sourceModel, fileName } = c.req.valid('json')
    const asset = await deps.mediaAssets.findById(mediaAssetId)
    const problem = assetProblem(asset, project)
    if (asset === null || problem !== null) {
      return c.json(fail(VALIDATION_ERROR_MESSAGE, { mediaAssetId: [problem ?? FOREIGN_ASSET_MESSAGE] }), 422)
    }

    // 取り込み直し（スクリプトのやり直しなど）で同じ動画の Take を増やさない。
    const existing = (await deps.takes.findByShot(shot.id)).find((take) => take.mediaAssetId === asset.id)
    if (existing !== undefined) return c.json(ok(toTakeResponse(existing)), 200)

    const spec = importSpec(project, shot, asset)
    const take = await deps.takes.create({
      shotId: shot.id,
      mediaAssetId: asset.id,
      spec,
      specHash: await computeSpecHash(spec),
      providerId: IMPORT_PROVIDER_ID,
      modelId: IMPORT_MODEL_ID,
      providerParams: { kind: 'import', sourceModel, fileName },
      seedUsed: null,
      // アプリの外で払った分は分からない。0 として費用メーターに「持ち込み」と出す。
      costUsd: 0,
      generationTimeSec: 0,
      parentTakeId: null,
      regenerationReason: null,
    })

    // 採用は動かさない。採用前なら「採用待ち」、採用済みならそのまま。
    const updated = await deps.shots.updateStatus(
      shot.id,
      settledShotStatus({ hasSelectedTake: shot.selectedTakeId !== null, hasTakes: true }),
    )
    await publishShotStatus(deps, updated)
    return c.json(ok(toTakeResponse(take)), 201)
  })
