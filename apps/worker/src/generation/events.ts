import type {
  GenerationJobId,
  GenerationJobStatus,
  ProjectEvent,
  ProjectEventPublisher,
  Shot,
  ShotStatus,
  TakeId,
} from '@ixa/domain'
import type { Logger } from 'pino'

/**
 * worker が状態を変えた瞬間に流す出来事の組み立てと送出（Phase 5.8b）。
 *
 * **出来事の形の正は `packages/domain/src/events/project-event.ts`。**
 * ここは「いつ・どの値で流すか」だけを持つ。形を独自に持つと API 側とズレる（lessons L-016）。
 */

export type ProjectEventDeps = {
  readonly events: ProjectEventPublisher
  readonly logger: Logger
}

/**
 * 出来事を流す。**失敗しても呼び出し元の処理を止めない。**
 * 通知は状態変更への上乗せであり、通知が落ちたことを理由に Take の確定を
 * 巻き戻すことはない（`ProjectEventPublisher` の契約）。
 *
 * ただし黙って捨てない。落ちた事実は必ず warn に残す。
 */
const publishOrWarn = async (
  deps: ProjectEventDeps,
  jobId: GenerationJobId,
  event: ProjectEvent,
): Promise<void> => {
  try {
    await deps.events.publish(event)
  } catch (error) {
    deps.logger.warn(
      { jobId, eventType: event.type, shotId: event.shotId, err: error },
      '出来事を流せませんでした。画面の表示が古いままになることがあります',
    )
  }
}

/** 出来事に載せる Shot。projectId は Shot にしか無い。 */
type EventShot = Pick<Shot, 'id' | 'projectId'>

/** 生成ジョブの状態が変わったことを流す。 */
export const publishJobStatus = (
  deps: ProjectEventDeps,
  params: {
    readonly shot: EventShot
    readonly jobId: GenerationJobId
    readonly status: GenerationJobStatus
    /** 成功したときだけ入る。 */
    readonly takeId: TakeId | null
    /** 失敗したときだけ入る。**空にしない**（lessons L-015）。 */
    readonly error: string | null
    readonly at: Date
  },
): Promise<void> =>
  publishOrWarn(deps, params.jobId, {
    type: 'generation_job.status',
    projectId: params.shot.projectId,
    shotId: params.shot.id,
    jobId: params.jobId,
    status: params.status,
    takeId: params.takeId,
    error: params.error,
    // 起きた時刻は流す側の時計で決める。受け手の時計を使わない。
    at: params.at.toISOString(),
  })

/** Shot の状態が変わったことを流す。 */
export const publishShotStatus = (
  deps: ProjectEventDeps,
  params: {
    readonly shot: EventShot
    readonly jobId: GenerationJobId
    readonly status: ShotStatus
    readonly at: Date
  },
): Promise<void> =>
  publishOrWarn(deps, params.jobId, {
    type: 'shot.status',
    projectId: params.shot.projectId,
    shotId: params.shot.id,
    status: params.status,
    at: params.at.toISOString(),
  })

/**
 * 失敗の理由を必ず言葉にする。message が空のまま記録して流すと、行にも画面にも
 * 「失敗」とだけ残り、何が起きたか誰にも分からなくなる（lessons L-015）。
 * **行と出来事で同じ文字列を使うこと。** 別々に組み立てると必ずズレる。
 */
export const failureMessageOf = (failure: { readonly code: string; readonly message: string }): string =>
  failure.message.trim() === '' ? `原因不明の失敗です（code=${failure.code}）` : failure.message

/**
 * 配信先がまだ配線されていないときの仮の口。
 *
 * **黙って成功させない。** 何も出さずに resolve すると、画面が更新されない理由が
 * どこにも残らず「SSE が壊れている」を延々と探すことになる（lessons L-015）。
 * 実体（`packages/events`）を注入したらこの warn は消える。
 */
export const createUnwiredEventPublisher = (logger: Logger): ProjectEventPublisher => ({
  publish: (event) => {
    logger.warn(
      { eventType: event.type, projectId: event.projectId, shotId: event.shotId },
      '出来事の配信先が配線されていません。画面はリアルタイムに更新されません',
    )
    return Promise.resolve()
  },
})
