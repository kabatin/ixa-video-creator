import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  ImageJobRepository,
  MediaAssetRepository,
  ProjectRepository,
  ShotReferenceRepository,
  ShotRepository,
  TakeRepository,
} from '@ixa/db'
import { manualStartFrameOf } from '@ixa/generation'
import {
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  TakeId as TakeIdSchema,
  type MediaAsset,
  type MediaAssetId,
  type Shot,
  type ShotId,
  type Take,
  type TakeId,
} from '@ixa/domain'
import type { ObjectStorage } from '@ixa/storage'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, okList } from '../response.js'
import { DEFAULT_SIGNED_URL_EXPIRES_SEC, DERIVED_NOT_READY_MESSAGE } from './media.js'

/**
 * Shot 一覧に出すサムネイルを **1 応答でまとめて発行する**。
 * 27 行の一覧に 27 回 URL を取りに行かせないために在る。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 *
 * 署名付き URL は DB に保存せず都度発行する（CLAUDE.md 規約 7）。
 * 期限は `media.ts` の既定を **import して使う**。書き写すと必ずズレる（L-016）。
 */

/**
 * 絵が出せなかった理由。**`thumbnailUrl: null` と必ず対にする**（L-015）。
 * まとめて「出せません」にすると、待てば出るのか壊れているのかが消える。
 */
export const SHOT_POSTER_REASON = {
  /**
   * 採用 Take が無い理由は **Shot の状態で言い分ける**。以前は一律「Take が選ばれていません」で、
   * 生成直後のカードにも生成前のカードにも同じ文が出て、次の一手が読めなかった。
   */
  /** まだ Take が 1 本も無い（下書き・生成可能・要判断）。 */
  noTake: 'まだ Take がありません',
  /** Take はあるが採用していない（採用待ち）。次の一手は採用。 */
  notAdopted: 'Take を採用すると表示されます',
  /** 生成中。待てば Take ができる。 */
  generating: '生成中です',
  /** 採用 Take の行が引けない。選択と実体がずれている（異常）。 */
  takeMissing: '採用 Take が見つかりません',
  /** MediaAsset の行が引けない。削除済みか、取り込みが失敗している（異常）。 */
  mediaMissing: 'メディアが見つかりません',
  /** MediaAsset は在るが派生物がまだ。待てば出る。 */
  thumbnailNotReady: DERIVED_NOT_READY_MESSAGE,
  /** 絵コンテの画像（最初のフレーム）を作っている（ADR-0029）。 */
  drawing: '絵コンテの画像を作っています',
} as const

/**
 * URL と理由は**どちらか一方だけが null**。
 * 両方 null は「理由の無い空枠」で、見る人には検査済みの空白と区別が付かない（L-015）。
 * 型（`ShotPoster`）でも同じ対を強制しているが、スキーマにも書いて OpenAPI に出す。
 */
export const URL_AND_REASON_PAIR_MESSAGE =
  'thumbnailUrl と reason は、どちらか一方だけが null でなければならない'

export const ShotPosterResponse = z
  .object({
    shotId: ShotIdSchema,
    takeId: TakeIdSchema.nullable().openapi({ description: '採用 Take。未選択なら null' }),
    thumbnailUrl: z
      .string()
      .min(1)
      .nullable()
      .openapi({ description: '都度発行する署名付き GET URL。出せないときは null' }),
    reason: z
      .string()
      .min(1)
      .nullable()
      .openapi({ description: 'thumbnailUrl が null のときの理由。URL があるときは null' }),
    pending: z.boolean().openapi({
      description: '待てば出る（サムネイルを作っている）。画面はこれが true の間だけ取り直す',
    }),
    hasStartFrame: z.boolean().openapi({
      description:
        '最初のフレーム（絵コンテの画像）が付いているか。採用 Take があっても見る（流れの帯・説明も絵も無い Shot の確認）',
    }),
  })
  .refine((entry) => (entry.thumbnailUrl === null) !== (entry.reason === null), {
    message: URL_AND_REASON_PAIR_MESSAGE,
  })
  .openapi('ShotPoster')
export type ShotPosterResponse = z.infer<typeof ShotPosterResponse>

/**
 * 1 行分の結果。**URL と理由を型で対にする。**
 * 片方だけ返す形は書けない（`reason` を落とすとコンパイルが通らない）。
 */
export type ShotPoster =
  | { shotId: ShotId; takeId: TakeId | null; thumbnailUrl: string; reason: null }
  | { shotId: ShotId; takeId: TakeId | null; thumbnailUrl: null; reason: string }

/**
 * 待てば出るか（2026-09-27）。**サムネイルを作っている行だけ。**
 * 以前は生成が終わった瞬間に 1 回取るだけで、サムネイルがその後にできても画面が
 * 取り直さず、読み直すまで出なかった。画面はこれが true の間だけ取り直す。
 */
/** 応答の 1 行。待てば出るかの印と、最初のフレームがあるかを添える。 */
export type ShotPosterEntry = ShotPoster & {
  readonly pending: boolean
  readonly hasStartFrame: boolean
}

const isPending = (poster: ShotPoster): boolean =>
  poster.reason === SHOT_POSTER_REASON.thumbnailNotReady || poster.reason === SHOT_POSTER_REASON.drawing

export type ShotPosterRoutesDeps = {
  projects: ProjectRepository
  shots: ShotRepository
  takes: TakeRepository
  mediaAssets: MediaAssetRepository
  storage: ObjectStorage
  /** 最初のフレーム（採用 Take が無い Shot の絵に使う。ADR-0029）。 */
  shotReferences: Pick<ShotReferenceRepository, 'findByShot'>
  /** 絵コンテの画像を作っている Shot（その間は「作っています」と出す）。 */
  imageJobs: Pick<ImageJobRepository, 'findActiveByProject'>
}

/**
 * id の重複を除いて引き、Map にする。
 *
 * リポジトリに一括取得の口（`findByIds`）が無いため 1 件ずつ引くが、
 * **同じ id を 2 度引かず、行数分を直列にもしない**。
 */
const loadById = async <Id, Entity>(
  ids: readonly Id[],
  find: (id: Id) => Promise<Entity | null>,
): Promise<ReadonlyMap<Id, Entity>> => {
  const unique = [...new Set(ids)]
  // `async (id) => [id, await find(id)]` にすると Entity が Awaited<Entity> へ潰れるため then で受ける。
  const entries = await Promise.all(
    unique.map((id) => find(id).then((entity) => [id, entity] as const)),
  )
  return new Map(
    entries.filter((entry): entry is readonly [Id, Entity] => entry[1] !== null),
  )
}

/** 1 Shot について、どの状態で止まったかを決める。署名だけは呼び出し側が行う。 */
/** 採用 Take が無い Shot の最初のフレーム（ADR-0029）。絵を作っている間は `drawing`。 */
type StartFrameState = { readonly drawing: boolean; readonly assetId: MediaAssetId | null }

/**
 * 採用 Take が無い Shot の絵。**最初のフレーム（絵コンテの画像）があればそれを使う**（ADR-0029）。
 * 作っている間は「作っています」と言って待たせる。どちらも無ければ Shot の状態で言い分ける。
 */
const posterWithoutTake = (
  shot: Shot,
  startFrame: StartFrameState,
  assetsById: ReadonlyMap<MediaAssetId, MediaAsset>,
  urlByKey: ReadonlyMap<string, string>,
): ShotPoster => {
  const base = { shotId: shot.id, takeId: null }
  if (startFrame.drawing) return { ...base, thumbnailUrl: null, reason: SHOT_POSTER_REASON.drawing }

  const frame = startFrame.assetId === null ? undefined : assetsById.get(startFrame.assetId)
  if (frame !== undefined) {
    const url = frame.thumbnailKey === null ? undefined : urlByKey.get(frame.thumbnailKey)
    return url === undefined
      ? { ...base, thumbnailUrl: null, reason: SHOT_POSTER_REASON.thumbnailNotReady }
      : { ...base, thumbnailUrl: url, reason: null }
  }

  const reason =
    shot.status === 'review'
      ? SHOT_POSTER_REASON.notAdopted
      : shot.status === 'generating'
        ? SHOT_POSTER_REASON.generating
        : SHOT_POSTER_REASON.noTake
  return { ...base, thumbnailUrl: null, reason }
}

const resolveShotPoster = (
  shot: Shot,
  startFrame: StartFrameState,
  takesById: ReadonlyMap<TakeId, Take>,
  assetsById: ReadonlyMap<MediaAssetId, MediaAsset>,
  urlByKey: ReadonlyMap<string, string>,
): ShotPoster => {
  const base = { shotId: shot.id }

  if (shot.selectedTakeId === null) return posterWithoutTake(shot, startFrame, assetsById, urlByKey)

  const take = takesById.get(shot.selectedTakeId)
  if (take === undefined) {
    // 選択されているのに引けない。待っても出ないので「まだ」とは書かない。
    return {
      ...base,
      takeId: shot.selectedTakeId,
      thumbnailUrl: null,
      reason: SHOT_POSTER_REASON.takeMissing,
    }
  }

  const asset = assetsById.get(take.mediaAssetId)
  if (asset === undefined) {
    return {
      ...base,
      takeId: take.id,
      thumbnailUrl: null,
      reason: SHOT_POSTER_REASON.mediaMissing,
    }
  }

  if (asset.thumbnailKey === null) {
    return {
      ...base,
      takeId: take.id,
      thumbnailUrl: null,
      reason: SHOT_POSTER_REASON.thumbnailNotReady,
    }
  }

  const url = urlByKey.get(asset.thumbnailKey)
  if (url === undefined) {
    // 署名の対象を集め損ねた場合の受け皿。黙って空にしない。
    return {
      ...base,
      takeId: take.id,
      thumbnailUrl: null,
      reason: SHOT_POSTER_REASON.thumbnailNotReady,
    }
  }

  return { ...base, takeId: take.id, thumbnailUrl: url, reason: null }
}

/**
 * Project の全 Shot について、採用 Take のサムネイル URL をまとめて作る。
 *
 * Shot → Take → MediaAsset を **段ごとにまとめて**引く（行ごとの直列にしない）。
 */
export const buildShotPosters = async (
  deps: Omit<ShotPosterRoutesDeps, 'projects'>,
  shots: readonly Shot[],
): Promise<ShotPosterEntry[]> => {
  const takeIds = shots.flatMap((shot) =>
    shot.selectedTakeId === null ? [] : [shot.selectedTakeId],
  )
  const takesById = await loadById(takeIds, (id) => deps.takes.findById(id))

  const projectId = shots[0]?.projectId
  const drawing = new Set(
    projectId === undefined
      ? []
      : // キャラクターシートのジョブ（Shot を持たない）は数えない（ADR-0035）。
        (await deps.imageJobs.findActiveByProject(projectId)).flatMap((job) => (job.shotId === null ? [] : [job.shotId])),
  )
  // 最初のフレームは**全 Shot で引く**（あるかどうかを返すため）。絵に使うのは採用 Take が無い Shot だけ。
  const frameOf = new Map<ShotId, MediaAssetId | null>(
    await Promise.all(
      shots.map(
        async (shot) => [shot.id, await manualStartFrameOf(deps.shotReferences, shot.id)] as const,
      ),
    ),
  )
  const startFrames = new Map<ShotId, StartFrameState>(
    shots.map((shot): readonly [ShotId, StartFrameState] => {
      const needsFrame = shot.selectedTakeId === null && !drawing.has(shot.id)
      return [
        shot.id,
        {
          drawing: drawing.has(shot.id),
          assetId: needsFrame ? (frameOf.get(shot.id) ?? null) : null,
        },
      ]
    }),
  )

  const assetIds = [
    ...[...takesById.values()].map((take) => take.mediaAssetId),
    ...[...startFrames.values()].flatMap((frame) => (frame.assetId === null ? [] : [frame.assetId])),
  ]
  const assetsById = await loadById(assetIds, (id) => deps.mediaAssets.findById(id))

  const thumbnailKeys = [
    ...new Set(
      [...assetsById.values()].flatMap((asset) =>
        asset.thumbnailKey === null ? [] : [asset.thumbnailKey],
      ),
    ),
  ]
  const signed = await Promise.all(
    thumbnailKeys.map(
      async (key) =>
        [key, await deps.storage.signedGetUrl(key, DEFAULT_SIGNED_URL_EXPIRES_SEC)] as const,
    ),
  )
  const urlByKey = new Map(signed)

  return shots.map((shot) => {
    const poster = resolveShotPoster(
      shot,
      startFrames.get(shot.id) ?? { drawing: false, assetId: null },
      takesById,
      assetsById,
      urlByKey,
    )
    return {
      ...poster,
      pending: isPending(poster),
      hasStartFrame: (frameOf.get(shot.id) ?? null) !== null,
    }
  })
}

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const listShotPostersRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/shot-posters',
  tags: ['shots'],
  summary: 'Shot 全件の採用 Take のサムネイル URL をまとめて発行する',
  request: { params: ProjectParams },
  responses: {
    200: {
      description: 'Shot ごとのサムネイル（出せない行は理由が入る）',
      content: { 'application/json': { schema: listResponse(ShotPosterResponse) } },
    },
    404: errorContent('Project が存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

export const shotPosterRoutes = (deps: ShotPosterRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(
    listShotPostersRoute,
    async (c) => {
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.findById(projectId)
      if (project === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }
      const shots = await deps.shots.findByProject(projectId)
      return c.json(okList(await buildShotPosters(deps, shots)), 200)
    },
  )
