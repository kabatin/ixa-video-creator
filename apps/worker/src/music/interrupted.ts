import type { MusicJobRepository } from '@ixa/db'
import { isMusicJobFinished, type ProjectEventPublisher } from '@ixa/domain'
import type { Logger } from 'pino'
import { publishMusicJobStatus } from './events.js'
import { MusicJobData } from './job-data.js'

const INTERRUPTED_MESSAGE = '作っている途中で処理が止まりました。作り直してください。'

/**
 * キューが**処理の外で**ジョブを打ち切ったとき（worker が落ちたなど）、行を失敗にして画面へ知らせる。
 * 「作っています」のまま残ると、画面は二度と終わらない（声のジョブと同じ）。**投げない。**
 */
export const failInterruptedMusicJob = async (
  deps: {
    readonly musicJobs: Pick<MusicJobRepository, 'findById' | 'markFailed'>
    readonly events: ProjectEventPublisher
    readonly logger: Logger
  },
  data: unknown,
  queueReason: string,
): Promise<void> => {
  try {
    const parsed = MusicJobData.safeParse(data)
    if (!parsed.success) {
      deps.logger.error({ queueReason }, '打ち切られた曲のジョブのデータが読めません')
      return
    }
    const job = await deps.musicJobs.findById(parsed.data.musicJobId)
    if (job === null || isMusicJobFinished(job.status)) return
    deps.logger.error({ musicJobId: job.id, queueReason }, '曲のジョブがキューに打ち切られました。失敗にします')
    const failed = await deps.musicJobs.markFailed(job.id, { code: 'interrupted', message: INTERRUPTED_MESSAGE, retryable: true }, null)
    await publishMusicJobStatus(deps, failed)
  } catch (error) {
    deps.logger.error({ err: error, queueReason }, '打ち切られた曲のジョブを失敗にできませんでした')
  }
}
