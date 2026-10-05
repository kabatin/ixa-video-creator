import type { VoiceJobRepository } from '@ixa/db'
import type { ProjectEventPublisher } from '@ixa/domain'
import type { Logger } from 'pino'
import { publishVoiceJobStatus } from './events.js'
import { VoiceJobData } from './job-data.js'

const INTERRUPTED_MESSAGE = '作っている途中で処理が止まりました。作り直してください。'

/**
 * キューが**処理の外で**ジョブを打ち切ったとき（worker が落ちたなど）、行を失敗にして画面へ知らせる。
 * 「作っています」のまま残ると、その行は二度と頼めなくなる（絵のジョブと同じ）。**投げない。**
 */
export const failInterruptedVoiceJob = async (
  deps: { readonly voiceJobs: Pick<VoiceJobRepository, 'findById' | 'markFailed'>; readonly events: ProjectEventPublisher; readonly logger: Logger },
  data: unknown,
  queueReason: string,
): Promise<void> => {
  try {
    const parsed = VoiceJobData.safeParse(data)
    if (!parsed.success) {
      deps.logger.error({ queueReason }, '打ち切られた声のジョブのデータが読めません')
      return
    }
    const job = await deps.voiceJobs.findById(parsed.data.voiceJobId)
    if (job === null || job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') return
    deps.logger.error({ voiceJobId: job.id, lineId: job.lineId, queueReason }, '声のジョブがキューに打ち切られました。失敗にします')
    const failed = await deps.voiceJobs.markFailed(job.id, { code: 'interrupted', message: INTERRUPTED_MESSAGE, retryable: true }, null)
    await publishVoiceJobStatus(deps, failed)
  } catch (error) {
    deps.logger.error({ err: error, queueReason }, '打ち切られた声のジョブを失敗にできませんでした')
  }
}
