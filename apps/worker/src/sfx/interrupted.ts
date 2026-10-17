import type { SfxJobRepository } from '@ixa/db'
import { isSfxJobFinished, type ProjectEventPublisher } from '@ixa/domain'
import type { Logger } from 'pino'
import { publishSfxJobStatus } from './events.js'
import { SfxJobData } from './job-data.js'

const INTERRUPTED_MESSAGE = '作っている途中で処理が止まりました。作り直してください。'

/**
 * キューが**処理の外で**ジョブを打ち切ったとき（worker が落ちたなど）、行を失敗にして画面へ知らせる。
 * 「作っています」のまま残ると、画面は二度と終わらない（声のジョブと同じ）。**投げない。**
 */
export const failInterruptedSfxJob = async (
  deps: {
    readonly sfxJobs: Pick<SfxJobRepository, 'findById' | 'markFailed'>
    readonly events: ProjectEventPublisher
    readonly logger: Logger
  },
  data: unknown,
  queueReason: string,
): Promise<void> => {
  try {
    const parsed = SfxJobData.safeParse(data)
    if (!parsed.success) {
      deps.logger.error({ queueReason }, '打ち切られた効果音のジョブのデータが読めません')
      return
    }
    const job = await deps.sfxJobs.findById(parsed.data.sfxJobId)
    if (job === null || isSfxJobFinished(job.status)) return
    deps.logger.error({ sfxJobId: job.id, queueReason }, '効果音のジョブがキューに打ち切られました。失敗にします')
    const failed = await deps.sfxJobs.markFailed(job.id, { code: 'interrupted', message: INTERRUPTED_MESSAGE, retryable: true }, null)
    await publishSfxJobStatus(deps, failed)
  } catch (error) {
    deps.logger.error({ err: error, queueReason }, '打ち切られた効果音のジョブを失敗にできませんでした')
  }
}
