import type { ImageJobRepository } from '@ixa/db'
import type { ProjectEventPublisher } from '@ixa/domain'
import type { Logger } from 'pino'
import { publishImageJobStatus } from './events.js'
import { ImageJobData } from './job-data.js'

/** キューに打ち切られた印。画面の文とは別に、記録から拾えるようにする。 */
export const INTERRUPTED_IMAGE_JOB_CODE = 'interrupted'

const INTERRUPTED_MESSAGE = '作っている途中で処理が止まりました。作り直してください。'

/**
 * キューが**処理の外で**ジョブを打ち切ったとき、行を失敗にして画面へ知らせる
 * （制作者 2026-10-02「再度生成しようと思ったら生成中だからできないって言われた」）。
 *
 * `processImageJob` は失敗を自分で行に書くので、image キューの `failed` はここにしか来ない。
 * 作っている最中に worker が落ちる（再起動など）と、BullMQ は「止まりすぎ」でジョブを打ち切り、
 * 処理を呼ばない。行は「作っている」のまま残り、作り直しが断られ続けていた。
 *
 * **投げない。** ここは出来事の受け口で、投げても誰も拾えない。読めなければ記録だけ残す。
 */
export const failInterruptedImageJob = async (
  deps: {
    readonly imageJobs: Pick<ImageJobRepository, 'findById' | 'markFailed'>
    readonly events: ProjectEventPublisher
    readonly logger: Logger
  },
  data: unknown,
  queueReason: string,
): Promise<void> => {
  try {
    const parsed = ImageJobData.safeParse(data)
    if (!parsed.success) {
      deps.logger.error({ queueReason }, '打ち切られた絵のジョブのデータが読めません')
      return
    }
    const job = await deps.imageJobs.findById(parsed.data.imageJobId)
    if (job === null) {
      deps.logger.warn({ imageJobId: parsed.data.imageJobId, queueReason }, '打ち切られた絵のジョブが見つかりません')
      return
    }
    if (job.status === 'succeeded' || job.status === 'failed') return
    deps.logger.error(
      { imageJobId: job.id, shotId: job.shotId, queueReason },
      '絵のジョブがキューに打ち切られました。失敗にします',
    )
    const failed = await deps.imageJobs.markFailed(
      job.id,
      { code: INTERRUPTED_IMAGE_JOB_CODE, message: INTERRUPTED_MESSAGE, retryable: true },
      { queueFailure: queueReason },
    )
    await publishImageJobStatus(deps, failed)
  } catch (error) {
    deps.logger.error({ err: error, queueReason }, '打ち切られた絵のジョブを失敗にできませんでした')
  }
}
