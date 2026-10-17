import type { ProjectEventPublisher, SfxJob } from '@ixa/domain'
import type { Logger } from 'pino'

/** 効果音のジョブの状態を流す（ADR-0052）。**通知は上乗せ。** 落ちても置いた音は取り消さない。 */
export const publishSfxJobStatus = async (
  deps: { readonly events: ProjectEventPublisher; readonly logger: Logger },
  job: SfxJob,
): Promise<void> => {
  try {
    await deps.events.publish({
      type: 'sfx_job.status',
      projectId: job.projectId,
      at: new Date().toISOString(),
      jobId: job.id,
      status: job.status,
      timelineClipId: job.timelineClipId,
      error: job.error?.message ?? null,
    })
  } catch (error) {
    deps.logger.warn({ sfxJobId: job.id, err: error }, '出来事を流せませんでした。画面の表示が古いままになることがあります')
  }
}
