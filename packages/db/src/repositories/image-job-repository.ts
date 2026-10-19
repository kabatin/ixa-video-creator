import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import {
  ImageGenerationJob as ImageGenerationJobSchema,
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  imageJobViolation,
  newId,
  type ImageGenerationJob,
  type ImageGenerationJobError,
  type CharacterId,
  type ImageGenerationJobId,
  type MediaAssetId,
  type ModelId,
  type ProjectId,
  type ProviderId,
  type ShotId,
} from '@ixa/domain'
import type { DbExecutor } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { imageGenerationJobs } from '../schema/image-job.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type ImageJobRow = typeof imageGenerationJobs.$inferSelect

/**
 * 作るときの入力。持ち主は種類で決まる（最初のフレームは Shot、キャラクターシートはキャラクター。ADR-0035。
 * キーアートは作品だけ。ADR-0051）。
 */
export type CreateImageJobInput = {
  readonly projectId: ProjectId
  readonly providerId: ProviderId
  readonly modelId: ModelId
  /** やり直しのとき、前のジョブと何枚目か（ADR-0055）。省けば 1 枚目。 */
  readonly retryOf?: { readonly jobId: ImageGenerationJobId; readonly attempt: number }
} & (
  | { readonly kind: 'start_frame'; readonly shotId: ShotId }
  | {
      readonly kind: 'character_sheet'
      readonly characterId: CharacterId
      /** 手本の画像。頼んだときに決まる（最初のフレームは実行時に決まるので、ここには無い）。 */
      readonly referenceAssetIds: readonly MediaAssetId[]
    }
  | {
      /** サムネイルの背景（ADR-0051）。作品にだけ属する。参照は実行時に決まる（登場人物の識別画像）。 */
      readonly kind: 'key_art'
      /** 自由な指示。無ければ null。domain の `KeyArtInstruction` を通したもの。 */
      readonly instruction: string | null
    }
)

/**
 * やり直しのジョブの入力（ADR-0055）。前のジョブと同じ種類・持ち主・AI で、つながりに足す。
 * 自動のやり直し（worker）と人が押すやり直し（API）が同じ形で作るため、ここ 1 箇所に置く。
 */
export const retryImageJobInput = (job: ImageGenerationJob): CreateImageJobInput => {
  const common = {
    projectId: job.projectId,
    providerId: job.providerId,
    modelId: job.modelId,
    retryOf: { jobId: job.id, attempt: job.attempt + 1 },
  }
  if (job.kind === 'start_frame' && job.shotId !== null) return { ...common, kind: 'start_frame', shotId: job.shotId }
  if (job.kind === 'character_sheet' && job.characterId !== null) {
    return { ...common, kind: 'character_sheet', characterId: job.characterId, referenceAssetIds: job.referenceAssetIds }
  }
  if (job.kind === 'key_art') return { ...common, kind: 'key_art', instruction: job.instruction }
  throw new Error(`絵のジョブ ${job.id} の持ち主が種類と食い違っていて、やり直せません`)
}

/** 止める範囲。`shotIds` が無ければ Project の全部。 */
export type ImageJobCancelTarget = {
  readonly projectId: ProjectId
  readonly shotIds?: readonly ShotId[]
}

/** 絵を作るジョブの読み書き（ADR-0029）。戻り値は必ず `@ixa/domain` の型。 */
export type ImageJobRepository = {
  create(input: CreateImageJobInput): Promise<ImageGenerationJob>
  findById(id: ImageGenerationJobId): Promise<ImageGenerationJob | null>
  /** その Shot で待っている・動いているジョブ（同じ Shot に重ねて回さないため）。 */
  findActiveByShot(shotId: ShotId): Promise<ImageGenerationJob | null>
  /** その Shot の最後のジョブ（状態と失敗の理由を画面に出すため）。 */
  findLatestByShot(shotId: ShotId): Promise<ImageGenerationJob | null>
  /** そのキャラクターで待っている・動いているシートのジョブ（重ねて回さないため）。 */
  findActiveByCharacter(characterId: CharacterId): Promise<ImageGenerationJob | null>
  /** そのキャラクターの最後のシートのジョブ（状態と失敗の理由を画面に出すため）。 */
  findLatestByCharacter(characterId: CharacterId): Promise<ImageGenerationJob | null>
  /** Project の中で待っている・動いているジョブ。 */
  findActiveByProject(projectId: ProjectId): Promise<ImageGenerationJob[]>
  /** Project のキーアートのジョブ（ADR-0051）。新しい順。 */
  findKeyArtByProject(projectId: ProjectId): Promise<ImageGenerationJob[]>
  /** その Shot の開始フレームのジョブ全部（履歴。ADR-0055）。新しい順。 */
  findByShot(shotId: ShotId): Promise<ImageGenerationJob[]>
  /** その絵を作ったジョブ（識別画像・キーアートに印を付けるため。ADR-0055）。 */
  findByMediaAssetIds(mediaAssetIds: readonly MediaAssetId[]): Promise<ImageGenerationJob[]>
  /** そのジョブをやり直したジョブ（重ねてやり直さないため。ADR-0055）。無ければ null。 */
  findRetryOf(id: ImageGenerationJobId): Promise<ImageGenerationJob | null>
  /** そのジョブから前へ辿ったやり直しのつながり（1 枚目から順に、そのジョブまで）。 */
  findChainUpTo(id: ImageGenerationJobId): Promise<ImageGenerationJob[]>
  /**
   * 待っている・動いているジョブを止める（制作者 2026-10-04）。`shotIds` を渡せばその Shot の絵だけ、
   * 渡さなければ Project の全部（キャラクターシートも）。止めたジョブを返す。
   */
  cancelActive(target: ImageJobCancelTarget): Promise<ImageGenerationJob[]>
  markRunning(id: ImageGenerationJobId, referenceAssetIds: readonly MediaAssetId[]): Promise<ImageGenerationJob>
  markSucceeded(
    id: ImageGenerationJobId,
    mediaAssetId: MediaAssetId,
    providerRecord: Record<string, unknown>,
  ): Promise<ImageGenerationJob>
  /** 絵ができた。まだ当てずにチェックへ回す（ADR-0055）。 */
  markChecking(
    id: ImageGenerationJobId,
    mediaAssetId: MediaAssetId,
    providerRecord: Record<string, unknown>,
  ): Promise<ImageGenerationJob>
  /** チェックが済んだ（やり直しを積んだ・当てる絵を決めた）。チェック中の行だけを終える。 */
  finishChecking(id: ImageGenerationJobId): Promise<ImageGenerationJob>
  /** この絵を当てた印。止めた行には付けない。 */
  markApplied(id: ImageGenerationJobId): Promise<ImageGenerationJob>
  markFailed(
    id: ImageGenerationJobId,
    error: ImageGenerationJobError,
    providerRecord: Record<string, unknown> | null,
  ): Promise<ImageGenerationJob>
}

/**
 * row → Domain。zod で検証し、状態と中身の食い違いも止める（`imageJobViolation`）。
 * **黙って読み替えない。** 成功なのに絵が無い行を「絵なし」に畳むと、どこで落ちたか追えなくなる。
 */
export const imageJobRowToDomain = (row: ImageJobRow): ImageGenerationJob => {
  const job = ImageGenerationJobSchema.parse(row)
  const violation = imageJobViolation(job)
  if (violation !== null) throw new Error(`絵のジョブ ${row.id} の記録が壊れています: ${violation}`)
  return job
}

/** 動いている。チェック中も数える（チェック中・やり直し待ちの間に重ねて頼ませない。ADR-0055）。 */
const ACTIVE = inArray(imageGenerationJobs.status, ['queued', 'running', 'checking'])

/** つながりを辿る上限。既定の上限（2 回）と人の押したやり直しを足しても、ここまでは来ない。壊れた輪で止まらないため。 */
const MAX_CHAIN_LENGTH = 50

const first = async (rows: Promise<ImageJobRow[]>): Promise<ImageGenerationJob | null> => {
  const row = (await rows)[0]
  return row === undefined ? null : imageJobRowToDomain(row)
}

/** 種類ごとの持ち主と、頼んだときに決まる列。 */
const ownerOf = (input: CreateImageJobInput) => {
  switch (input.kind) {
    case 'start_frame':
      return { shotId: input.shotId, characterId: null, referenceAssetIds: [], instruction: null }
    case 'character_sheet':
      return { shotId: null, characterId: input.characterId, referenceAssetIds: [...input.referenceAssetIds], instruction: null }
    case 'key_art':
      return { shotId: null, characterId: null, referenceAssetIds: [], instruction: input.instruction }
  }
}

export const createImageJobRepository = (db: DbExecutor): ImageJobRepository => {
  /**
   * 状態を 1 つ進める。書く前に食い違いを確かめる（読み直しと同じ規則）。
   * **止めた行は上書きしない。** そのときは止めた行をそのまま返す（呼び出し側が `cancelled` を見て手を引く）。
   */
  const transition = async (
    id: ImageGenerationJobId,
    patch: Partial<typeof imageGenerationJobs.$inferInsert>,
  ): Promise<ImageGenerationJob> => {
    const rows = await db
      .update(imageGenerationJobs)
      .set(patch)
      .where(and(eq(imageGenerationJobs.id, id), ne(imageGenerationJobs.status, 'cancelled')))
      .returning()
    const row = rows[0]
    if (row !== undefined) return imageJobRowToDomain(row)
    const current = await first(db.select().from(imageGenerationJobs).where(eq(imageGenerationJobs.id, id)))
    if (current === null) throw new DbNotFoundError('image_generation_jobs', id)
    return current
  }

  const findRetryOf = (id: ImageGenerationJobId): Promise<ImageGenerationJob | null> =>
    first(
      db
        .select()
        .from(imageGenerationJobs)
        .where(eq(imageGenerationJobs.retryOfJobId, id))
        .orderBy(desc(imageGenerationJobs.id))
        .limit(1),
    )

  return {
    async create(input) {
      const owner = ownerOf(input)
      const rows = await db
        .insert(imageGenerationJobs)
        .values({
          id: newId(ImageGenerationJobIdSchema),
          projectId: input.projectId,
          kind: input.kind,
          ...owner,
          providerId: input.providerId,
          modelId: input.modelId,
          retryOfJobId: input.retryOf?.jobId ?? null,
          attempt: input.retryOf?.attempt ?? 1,
          status: 'queued',
          queuedAt: new Date(),
        })
        // 1 つのジョブのやり直しは 1 行だけ（一意の部分インデックス）。重ねて頼まれたら、先にできた行を返す。
        .onConflictDoNothing({ target: imageGenerationJobs.retryOfJobId, where: sql`${imageGenerationJobs.retryOfJobId} is not null` })
        .returning()
      const row = rows[0]
      if (row !== undefined) return imageJobRowToDomain(row)
      const existing = input.retryOf === undefined ? null : await findRetryOf(input.retryOf.jobId)
      if (existing === null) throw new Error('絵コンテの画像ジョブを作れませんでした')
      return existing
    },

    findById: (id) => first(db.select().from(imageGenerationJobs).where(eq(imageGenerationJobs.id, id))),

    findActiveByShot: (shotId) =>
      first(
        db
          .select()
          .from(imageGenerationJobs)
          .where(and(eq(imageGenerationJobs.shotId, shotId), ACTIVE))
          .orderBy(desc(imageGenerationJobs.id))
          .limit(1),
      ),

    findLatestByShot: (shotId) =>
      first(
        db
          .select()
          .from(imageGenerationJobs)
          .where(eq(imageGenerationJobs.shotId, shotId))
          .orderBy(desc(imageGenerationJobs.id))
          .limit(1),
      ),

    findActiveByCharacter: (characterId) =>
      first(
        db
          .select()
          .from(imageGenerationJobs)
          .where(and(eq(imageGenerationJobs.characterId, characterId), ACTIVE))
          .orderBy(desc(imageGenerationJobs.id))
          .limit(1),
      ),

    findLatestByCharacter: (characterId) =>
      first(
        db
          .select()
          .from(imageGenerationJobs)
          .where(eq(imageGenerationJobs.characterId, characterId))
          .orderBy(desc(imageGenerationJobs.id))
          .limit(1),
      ),

    async findActiveByProject(projectId) {
      const rows = await db
        .select()
        .from(imageGenerationJobs)
        .where(and(eq(imageGenerationJobs.projectId, projectId), ACTIVE))
        .orderBy(desc(imageGenerationJobs.id))
      return rows.map(imageJobRowToDomain)
    },

    async findKeyArtByProject(projectId) {
      const rows = await db
        .select()
        .from(imageGenerationJobs)
        .where(and(eq(imageGenerationJobs.projectId, projectId), eq(imageGenerationJobs.kind, 'key_art')))
        .orderBy(desc(imageGenerationJobs.id))
      return rows.map(imageJobRowToDomain)
    },

    async findByShot(shotId) {
      const rows = await db
        .select()
        .from(imageGenerationJobs)
        .where(and(eq(imageGenerationJobs.shotId, shotId), eq(imageGenerationJobs.kind, 'start_frame')))
        .orderBy(desc(imageGenerationJobs.id))
      return rows.map(imageJobRowToDomain)
    },

    async findByMediaAssetIds(mediaAssetIds) {
      if (mediaAssetIds.length === 0) return []
      const rows = await db
        .select()
        .from(imageGenerationJobs)
        .where(inArray(imageGenerationJobs.mediaAssetId, [...mediaAssetIds]))
      return rows.map(imageJobRowToDomain)
    },

    findRetryOf,

    async findChainUpTo(id) {
      const walk = async (
        current: ImageGenerationJobId | null,
        acc: readonly ImageGenerationJob[],
      ): Promise<readonly ImageGenerationJob[]> => {
        if (current === null || acc.length >= MAX_CHAIN_LENGTH) return acc
        const job = await first(db.select().from(imageGenerationJobs).where(eq(imageGenerationJobs.id, current)))
        return job === null ? acc : walk(job.retryOfJobId, [job, ...acc])
      }
      return [...(await walk(id, []))]
    },

    async cancelActive({ projectId, shotIds }) {
      if (shotIds !== undefined && shotIds.length === 0) return []
      const rows = await db
        .update(imageGenerationJobs)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(
          and(
            eq(imageGenerationJobs.projectId, projectId),
            ACTIVE,
            ...(shotIds === undefined ? [] : [inArray(imageGenerationJobs.shotId, [...shotIds])]),
          ),
        )
        .returning()
      return rows.map(imageJobRowToDomain)
    },

    markRunning: (id, referenceAssetIds) =>
      transition(id, { status: 'running', referenceAssetIds: [...referenceAssetIds], startedAt: new Date() }),

    markSucceeded: (id, mediaAssetId, providerRecord) =>
      transition(id, { status: 'succeeded', mediaAssetId, providerRecord, finishedAt: new Date() }),

    markChecking: (id, mediaAssetId, providerRecord) =>
      transition(id, { status: 'checking', mediaAssetId, providerRecord }),

    async finishChecking(id) {
      const rows = await db
        .update(imageGenerationJobs)
        .set({ status: 'succeeded', finishedAt: new Date() })
        .where(and(eq(imageGenerationJobs.id, id), eq(imageGenerationJobs.status, 'checking')))
        .returning()
      const row = rows[0]
      if (row !== undefined) return imageJobRowToDomain(row)
      const current = await first(db.select().from(imageGenerationJobs).where(eq(imageGenerationJobs.id, id)))
      if (current === null) throw new DbNotFoundError('image_generation_jobs', id)
      return current
    },

    markApplied: (id) => transition(id, { appliedAt: new Date() }),

    markFailed: (id, error, providerRecord) =>
      transition(id, { status: 'failed', error, providerRecord, finishedAt: new Date() }),
  }
}
