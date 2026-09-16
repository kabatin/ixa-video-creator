import type { ProjectRepository, ReviewRepository, ShotRepository, TakeRepository } from '@ixa/db'
import {
  TakeId as TakeIdSchema,
  canRegenerate,
  resolveRegenerationPolicy,
  type Project,
  type ProjectId,
  type RegenerationState,
  type Shot,
  type ShotId,
  type TakeId,
} from '@ixa/domain'
import type { Logger } from 'pino'
import { z } from 'zod'
import { decideRegenerationAdjustment, type RegenerationAdjustment } from './adjustment.js'

/**
 * 再生成ループ（docs/ARCHITECTURE.md §13 / docs/DOMAIN.md §12）。
 *
 * - ジョブデータは ID のみ。実データは DB から読む（DB が真実。ADR-0008）
 * - **上限判定は `@ixa/domain` の `canRegenerate` だけが持つ。**
 *   worker 側に同じ判定を書かない。2 箇所に散ると、片方だけ緩めた瞬間に無限ループになる
 * - 上限に触れたら Shot を blocked にして止め、理由をログと戻り値の両方に残す
 */

export const RegenerationJobData = z.object({ takeId: TakeIdSchema })
export type RegenerationJobData = z.infer<typeof RegenerationJobData>

/** 次の生成を頼む要求。Take / Shot の ID と「何を変えるか」だけを渡す。 */
export type RegenerationRequest = {
  readonly shotId: ShotId
  readonly projectId: ProjectId
  /** 系譜を辿れるようにする。新しい Take の parentTakeId になる。 */
  readonly parentTakeId: TakeId
  /** 新しい Take の regenerationReason になる文字列。 */
  readonly reason: string
  readonly adjustment: RegenerationAdjustment
}

/**
 * 生成ジョブを積む口。BullMQ / Redis への依存を配線側に閉じ込める
 * （このモジュールは import しただけでは何も起こさない。CLAUDE.md 規約 7b）。
 */
export type RegenerationQueue = {
  enqueue(request: RegenerationRequest): Promise<void>
}

export type RegenerationProcessorDeps = {
  readonly takes: Pick<
    TakeRepository,
    'findById' | 'findByShot' | 'sumCostByShot' | 'sumCostByProject'
  >
  readonly shots: Pick<ShotRepository, 'findById' | 'updateStatus'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly reviews: Pick<ReviewRepository, 'findLatestRunByTake' | 'findFindingsByRun'>
  readonly queue: RegenerationQueue
  readonly logger: Logger
}

export type RegenerationOutcome =
  | { readonly state: 'queued'; readonly reason: string }
  | { readonly state: 'blocked'; readonly reason: string }
  | { readonly state: 'skipped'; readonly reason: string }

/**
 * 再生成の試行回数。
 *
 * **Shot の Take 数を数える。** 再生成系譜（parentTakeId）の深さではない。
 * 系譜の深さは「親が正しく記録されている」ことに依存するが、現時点の
 * `apps/worker/src/generation/complete.ts` は Take を `parentTakeId: null` で作る。
 * それを前提に数えると深さが常に 0 になり、上限判定が素通りして無限ループになる。
 * Take 数なら 1 回生成するたび必ず 1 増えるので、記録漏れでループが止まらなくなることがない。
 *
 * 人が手で作った Take も数に入るが、上限判定は「このショットに何回お金を使ったか」を
 * 見るべきなので、その意味でも Take 数の方が正しい。
 */
const countAttempts = async (
  deps: RegenerationProcessorDeps,
  shotId: ShotId,
): Promise<number> => (await deps.takes.findByShot(shotId)).length

const loadState = async (
  deps: RegenerationProcessorDeps,
  shot: Shot,
  project: Project,
): Promise<RegenerationState> => {
  const [attempts, shotCostUsd, projectCostUsd] = await Promise.all([
    countAttempts(deps, shot.id),
    deps.takes.sumCostByShot(shot.id),
    deps.takes.sumCostByProject(project.id),
  ])
  return { attempts, shotCostUsd, projectCostUsd }
}

/** Shot を止めて人間に渡す。理由はログにも戻り値にも必ず残す。 */
const block = async (
  deps: RegenerationProcessorDeps,
  shot: Shot,
  takeId: TakeId,
  reason: string,
  state: RegenerationState,
): Promise<RegenerationOutcome> => {
  await deps.shots.updateStatus(shot.id, 'blocked')
  deps.logger.warn(
    { shotId: shot.id, takeId, reason, ...state },
    '再生成を止めて人間の判断に渡しました',
  )
  return { state: 'blocked', reason }
}

const skip = (
  deps: RegenerationProcessorDeps,
  takeId: TakeId,
  reason: string,
): RegenerationOutcome => {
  deps.logger.debug({ takeId, reason }, '再生成の対象ではないので何もしません')
  return { state: 'skipped', reason }
}

/**
 * regeneration ジョブを 1 件処理する。
 *
 * Take / Shot / Project が見つからない場合だけ throw する（ジョブデータが実在しない行を
 * 指している＝再試行しても直らないが、握り潰すと原因が消えるため）。
 * それ以外は queued / blocked / skipped のいずれかを返す。
 */
export const processRegenerationJob = async (
  deps: RegenerationProcessorDeps,
  data: unknown,
): Promise<RegenerationOutcome> => {
  const { takeId } = RegenerationJobData.parse(data)

  const take = await deps.takes.findById(takeId)
  if (take === null) throw new Error(`Take が見つかりません: ${takeId}`)

  const shot = await deps.shots.findById(take.shotId)
  if (shot === null) throw new Error(`Take ${takeId} の Shot が見つかりません: ${take.shotId}`)

  const project = await deps.projects.findById(shot.projectId)
  if (project === null) {
    throw new Error(`Shot ${shot.id} の Project が見つかりません: ${shot.projectId}`)
  }

  const run = await deps.reviews.findLatestRunByTake(take.id)
  if (run === null) return skip(deps, take.id, 'no_review_run')
  if (run.verdict !== 'fail') return skip(deps, take.id, `verdict=${run.verdict ?? 'null'}`)

  // ポリシーは Project から導く。既定値を worker 側で組み立て直さない（出どころを 1 つにする）。
  const policy = resolveRegenerationPolicy(project)
  const state = await loadState(deps, shot, project)

  // 上限判定はここだけ。判定の中身は domain の純粋関数が持つ（ARCHITECTURE.md §13）。
  const gate = canRegenerate(policy, state)
  if (!gate.allowed) return block(deps, shot, take.id, gate.reason, state)

  const findings = await deps.reviews.findFindingsByRun(run.id)
  const decision = decideRegenerationAdjustment(policy, findings)
  if (decision.kind === 'human') return block(deps, shot, take.id, decision.reason, state)

  const { adjustment } = decision
  await deps.queue.enqueue({
    shotId: shot.id,
    projectId: project.id,
    parentTakeId: take.id,
    reason: adjustment.reason,
    adjustment,
  })

  deps.logger.info(
    {
      shotId: shot.id,
      takeId: take.id,
      attempts: state.attempts,
      actions: adjustment.actions.map((a) => a.kind),
      changeSeed: adjustment.changeSeed,
    },
    '再生成をキューへ積みました',
  )
  return { state: 'queued', reason: adjustment.reason }
}
