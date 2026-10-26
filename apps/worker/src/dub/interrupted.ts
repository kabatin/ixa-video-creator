import type { DubJobRepository } from '@ixa/db'
import type { Logger } from 'pino'
import { DubJobData } from './job-data.js'

const INTERRUPTED_MESSAGE = '差し替えている途中で処理が止まりました。もう一度差し替えてください'

/**
 * キューが**処理の外で**ジョブを打ち切ったとき（worker が落ちたなど）、行を失敗にする。
 * 「差し替えている」のまま残ると、その Shot は二度と差し替えを頼めなくなる。**投げない。**
 */
export const failInterruptedDubJob = async (
  deps: { readonly dubJobs: Pick<DubJobRepository, 'findById' | 'markFailed'>; readonly logger: Logger },
  data: unknown,
  queueReason: string,
): Promise<void> => {
  try {
    const parsed = DubJobData.safeParse(data)
    if (!parsed.success) {
      deps.logger.error({ queueReason }, '打ち切られた差し替えのジョブのデータが読めません')
      return
    }
    const job = await deps.dubJobs.findById(parsed.data.dubJobId)
    if (job === null || job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') return
    deps.logger.error({ dubJobId: job.id, queueReason }, '差し替えのジョブがキューに打ち切られました。失敗にします')
    // 払った額は読み上げのたびに足してあるので、ここでは触らない。
    await deps.dubJobs.markFailed(job.id, { code: 'interrupted', message: INTERRUPTED_MESSAGE, retryable: true })
  } catch (error) {
    deps.logger.error({ err: error, queueReason }, '打ち切られた差し替えのジョブを失敗にできませんでした')
  }
}
