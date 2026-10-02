import { z } from 'zod'
import { CharacterId, GenerationJobId, ImageGenerationJobId, ProjectId, ShotId, TakeId } from '../common/ids.js'
import { ImageGenerationJobStatus } from '../generation/image-job.js'
import { GenerationJobStatus } from '../generation/take.js'
import { ShotStatus } from '../shot/shot.js'

/**
 * Project の中で起きた変化を、画面へ即時に伝えるための出来事（Phase 5.8b）。
 *
 * 27 件を一括で生成に回したあと、27 件の状態を再読み込みで追うのは無理がある。
 * worker と API が状態を変えた瞬間にこれを流し、画面は SSE で受けて
 * その場の表示を書き換える。
 *
 * **出来事は「何が起きたか」だけを運ぶ。** 行の全体は運ばない。
 * 画面は必要なら ID で引き直す。運ぶ物を増やすと、出来事の形が行の形に引きずられて
 * 変えられなくなる。
 *
 * **正はここだけ。** チャンネル名や配信の手段（Redis / メモリ）は `packages/events` が持つが、
 * 出来事の形は domain が決める。API と worker が別々に形を持つと必ずズレる（lessons L-016）。
 */

const base = {
  projectId: ProjectId,
  /** 起きた時刻（ISO 8601）。順序の判断に使う。**受け手の時計を使わない。** */
  at: z.string().datetime(),
}

export const ProjectEvent = z.discriminatedUnion('type', [
  /** Shot の状態が変わった。生成に回した・Take ができた・採用した、など。 */
  z.object({
    ...base,
    type: z.literal('shot.status'),
    shotId: ShotId,
    status: ShotStatus,
  }),
  /** 生成ジョブの状態が変わった。1 件の Shot に複数のジョブが並ぶことがある。 */
  z.object({
    ...base,
    type: z.literal('generation_job.status'),
    shotId: ShotId,
    jobId: GenerationJobId,
    status: GenerationJobStatus,
    /** 成功したときだけ入る。失敗・実行中は null。 */
    takeId: TakeId.nullable(),
    /** 失敗したときの理由。成功・実行中は null。**黙って失敗にしない**（lessons L-015）。 */
    error: z.string().nullable(),
  }),
  /**
   * 絵を作るジョブの状態が変わった（ADR-0029）。最初のフレームなら `shotId`、キャラクターシートなら `characterId`
   * （ADR-0035）。成功したら最初のフレーム・識別画像の四面図も替わっている。
   */
  z.object({
    ...base,
    type: z.literal('image_job.status'),
    shotId: ShotId.nullable(),
    /** キャラクターシートのとき。前からの出来事には無いので、無ければ null。 */
    characterId: CharacterId.nullable().default(null),
    jobId: ImageGenerationJobId,
    status: ImageGenerationJobStatus,
    /** 失敗したときの理由。成功・実行中は null。 */
    error: z.string().nullable(),
  }),
])
export type ProjectEvent = z.infer<typeof ProjectEvent>

export type ProjectEventType = ProjectEvent['type']

/**
 * 出来事を流す口。**publish は失敗しても呼び出し元の処理を止めない**のが約束。
 * 通知は状態の変更に対する上乗せで、通知が落ちたからといって Take の確定を
 * 巻き戻すことはない。失敗は必ずログに残す。
 */
export type ProjectEventPublisher = {
  readonly publish: (event: ProjectEvent) => Promise<void>
}

/**
 * 出来事を受ける口。1 つの Project について購読し、解除する関数を返す。
 * **解除を忘れると接続が漏れる。** SSE の切断時に必ず呼ぶ。
 */
export type ProjectEventSubscriber = {
  readonly subscribe: (
    projectId: ProjectId,
    onEvent: (event: ProjectEvent) => void,
  ) => Promise<() => Promise<void>>
}

/** 出来事の型のうち、Shot の一覧が描き直しに使うもの。増えたらここが型エラーになる。 */
export const SHOT_LIST_EVENT_TYPES: readonly ProjectEventType[] = [
  'shot.status',
  'generation_job.status',
  'image_job.status',
]
