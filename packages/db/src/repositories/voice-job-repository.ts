import { and, count, desc, eq, inArray, ne, sum } from 'drizzle-orm'
import {
  VoiceJob as VoiceJobSchema,
  VoiceJobId as VoiceJobIdSchema,
  newId,
  voiceJobViolation,
  type MediaAssetId,
  type NarrationLineId,
  type NarrationTakeId,
  type ProjectId,
  type VoiceJob,
  type VoiceJobError,
  type VoiceJobId,
  type VoiceJobKind,
  type VoiceProfileId,
  type VoiceSpec,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { voiceJobs } from '../schema/narration.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type VoiceJobRow = typeof voiceJobs.$inferSelect

/** 作るときの入力。要るものは種類で決まる（domain の `voiceJobViolation` が縛る）。 */
export type CreateVoiceJobInput = {
  readonly projectId: ProjectId
  readonly tool: string
  readonly model: string | null
} & (
  | { readonly kind: 'speak'; readonly lineId: NarrationLineId; readonly voiceProfileId: VoiceProfileId; readonly spec: VoiceSpec }
  | { readonly kind: 'preview'; readonly voiceProfileId: VoiceProfileId; readonly spec: VoiceSpec }
  | {
      readonly kind: 'transcribe'
      readonly inputMediaAssetId: MediaAssetId
      /** 分けた行に付ける声（無ければ未定）。 */
      readonly voiceProfileId: VoiceProfileId | null
      readonly placeAtSec: number
    }
  | {
      readonly kind: 'char_timing'
      readonly lineId: NarrationLineId
      readonly takeId: NarrationTakeId
      readonly inputMediaAssetId: MediaAssetId
    }
)

/** 止める範囲。`lineIds` が無ければ作品の全部（試しに読む・文字起こしも）。 */
export type VoiceJobCancelTarget = {
  readonly projectId: ProjectId
  readonly lineIds?: readonly NarrationLineId[]
}

export type VoiceJobOutcome = {
  readonly costUsd: number
  readonly providerRecord: Record<string, unknown>
  /** できた音（試しに読む）。 */
  readonly resultMediaAssetId?: MediaAssetId
}

/** 声のジョブの読み書き（ADR-0038）。戻り値は必ず `@ixa/domain` の型。 */
export type VoiceJobRepository = {
  create(input: CreateVoiceJobInput): Promise<VoiceJob>
  findById(id: VoiceJobId): Promise<VoiceJob | null>
  /** 作品の中で待っている・動いているジョブ。 */
  findActiveByProject(projectId: ProjectId): Promise<VoiceJob[]>
  /** 作品の行ごとの最後のジョブ（状態と失敗の理由を画面に出すため）。 */
  findLatestByLines(lineIds: readonly NarrationLineId[]): Promise<VoiceJob[]>
  cancelActive(target: VoiceJobCancelTarget): Promise<VoiceJob[]>
  markRunning(id: VoiceJobId): Promise<VoiceJob>
  markSucceeded(id: VoiceJobId, outcome: VoiceJobOutcome): Promise<VoiceJob>
  /** 失敗。途中まで払った額があれば残す（費用に入れる）。 */
  markFailed(id: VoiceJobId, error: VoiceJobError, costUsd: number | null): Promise<VoiceJob>
  /** 作品で声・文字起こしに掛かった額の合計（費用の表示と予算に入れる）。 */
  sumCostByProject(projectId: ProjectId): Promise<number>
  /** 種類ごとの額と回数（費用の表示の内訳。額が付いた＝終わったジョブだけ数える）。 */
  costByKind(projectId: ProjectId): Promise<readonly { readonly kind: VoiceJobKind; readonly runCount: number; readonly totalUsd: number }[]>
}

/** row → Domain。種類に要るものが無い行は、黙って読み替えず失敗する。 */
export const voiceJobRowToDomain = (row: VoiceJobRow): VoiceJob => {
  const job = VoiceJobSchema.parse({
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    lineId: row.lineId,
    takeId: row.takeId,
    voiceProfileId: row.voiceProfileId,
    inputMediaAssetId: row.inputMediaAssetId,
    resultMediaAssetId: row.resultMediaAssetId,
    placeAtSec: row.placeAtSec,
    tool: row.tool,
    model: row.model,
    spec: row.spec,
    status: row.status,
    costUsd: row.costUsd,
    error: row.error,
    providerRecord: row.providerRecord,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  })
  const violation = voiceJobViolation(job)
  if (violation !== null) throw new Error(`声のジョブ ${row.id} の記録が壊れています: ${violation}`)
  return job
}

const ACTIVE = inArray(voiceJobs.status, ['queued', 'running'])

const valuesOf = (input: CreateVoiceJobInput) => {
  const base = { projectId: input.projectId, kind: input.kind, tool: input.tool, model: input.model }
  switch (input.kind) {
    case 'speak':
      return { ...base, lineId: input.lineId, voiceProfileId: input.voiceProfileId, spec: input.spec }
    case 'preview':
      return { ...base, voiceProfileId: input.voiceProfileId, spec: input.spec }
    case 'transcribe':
      return { ...base, inputMediaAssetId: input.inputMediaAssetId, voiceProfileId: input.voiceProfileId, placeAtSec: input.placeAtSec }
    case 'char_timing':
      return { ...base, lineId: input.lineId, takeId: input.takeId, inputMediaAssetId: input.inputMediaAssetId }
  }
}

export const createVoiceJobRepository = (db: DbClient): VoiceJobRepository => {
  const first = (rows: VoiceJobRow[]): VoiceJob | null => {
    const row = rows[0]
    return row === undefined ? null : voiceJobRowToDomain(row)
  }

  /** 状態を 1 つ進める。**止めた行は上書きしない**（そのときは止めた行を返す。呼び出し側が手を引く）。 */
  const transition = async (id: VoiceJobId, patch: Partial<typeof voiceJobs.$inferInsert>): Promise<VoiceJob> => {
    const updated = first(
      await db.update(voiceJobs).set(patch).where(and(eq(voiceJobs.id, id), ne(voiceJobs.status, 'cancelled'))).returning(),
    )
    if (updated !== null) return updated
    const current = first(await db.select().from(voiceJobs).where(eq(voiceJobs.id, id)))
    if (current === null) throw new DbNotFoundError('voice_jobs', id)
    return current
  }

  return {
    async create(input) {
      const created = first(
        await db
          .insert(voiceJobs)
          .values({ id: newId(VoiceJobIdSchema), ...valuesOf(input), status: 'queued', queuedAt: new Date() })
          .returning(),
      )
      if (created === null) throw new Error('声のジョブを作れませんでした')
      return created
    },

    findById: async (id) => first(await db.select().from(voiceJobs).where(eq(voiceJobs.id, id))),

    async findActiveByProject(projectId) {
      const rows = await db
        .select()
        .from(voiceJobs)
        .where(and(eq(voiceJobs.projectId, projectId), ACTIVE))
        .orderBy(desc(voiceJobs.id))
      return rows.map(voiceJobRowToDomain)
    },

    async findLatestByLines(lineIds) {
      if (lineIds.length === 0) return []
      const rows = await db
        .selectDistinctOn([voiceJobs.lineId])
        .from(voiceJobs)
        .where(inArray(voiceJobs.lineId, [...lineIds]))
        .orderBy(voiceJobs.lineId, desc(voiceJobs.id))
      return rows.map(voiceJobRowToDomain)
    },

    async cancelActive({ projectId, lineIds }) {
      if (lineIds !== undefined && lineIds.length === 0) return []
      const rows = await db
        .update(voiceJobs)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(
          and(
            eq(voiceJobs.projectId, projectId),
            ACTIVE,
            ...(lineIds === undefined ? [] : [inArray(voiceJobs.lineId, [...lineIds])]),
          ),
        )
        .returning()
      return rows.map(voiceJobRowToDomain)
    },

    markRunning: (id) => transition(id, { status: 'running', startedAt: new Date() }),

    markSucceeded: (id, outcome) =>
      transition(id, {
        status: 'succeeded',
        finishedAt: new Date(),
        costUsd: outcome.costUsd,
        providerRecord: outcome.providerRecord,
        ...(outcome.resultMediaAssetId === undefined ? {} : { resultMediaAssetId: outcome.resultMediaAssetId }),
      }),

    markFailed: (id, error, costUsd) => transition(id, { status: 'failed', finishedAt: new Date(), error, costUsd }),

    async costByKind(projectId) {
      const rows = await db
        .select({ kind: voiceJobs.kind, runCount: count(voiceJobs.costUsd), total: sum(voiceJobs.costUsd) })
        .from(voiceJobs)
        .where(eq(voiceJobs.projectId, projectId))
        .groupBy(voiceJobs.kind)
      return rows.map((row) => ({ kind: row.kind, runCount: row.runCount, totalUsd: Number(row.total ?? 0) }))
    },

    async sumCostByProject(projectId) {
      const [row] = await db
        .select({ total: sum(voiceJobs.costUsd) })
        .from(voiceJobs)
        .where(eq(voiceJobs.projectId, projectId))
      return Number(row?.total ?? 0)
    },
  }
}
