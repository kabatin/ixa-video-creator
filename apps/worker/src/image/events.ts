import type { ImageGenerationJob, ProjectEventPublisher } from '@ixa/domain'
import type { Logger } from 'pino'

/**
 * 絵コンテの画像ジョブの状態を知らせる（ADR-0029）。
 * **流せなくても本処理は止めない**（`ProjectEventPublisher` の約束）。落ちたことはログに残す。
 */
export const publishImageJobStatus = async (
  deps: { readonly events: ProjectEventPublisher; readonly logger: Logger },
  job: ImageGenerationJob,
): Promise<void> => {
  try {
    await deps.events.publish({
      type: 'image_job.status',
      projectId: job.projectId,
      at: new Date().toISOString(),
      shotId: job.shotId,
      jobId: job.id,
      status: job.status,
      error: job.error?.message ?? null,
    })
  } catch (error) {
    deps.logger.warn(
      { imageJobId: job.id, shotId: job.shotId, err: error },
      '出来事を流せませんでした。画面の表示が古いままになることがあります',
    )
  }
}
