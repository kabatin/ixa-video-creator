import type { ProjectEventPublisher, VoiceJob } from '@ixa/domain'
import type { Logger } from 'pino'

/** 声のジョブの状態を流す（ADR-0038）。**通知は上乗せ。** 落ちても声の Take は取り消さない。 */
export const publishVoiceJobStatus = async (
  deps: { readonly events: ProjectEventPublisher; readonly logger: Logger },
  job: VoiceJob,
): Promise<void> => {
  try {
    await deps.events.publish({
      type: 'voice_job.status',
      projectId: job.projectId,
      at: new Date().toISOString(),
      jobId: job.id,
      kind: job.kind,
      lineId: job.lineId,
      status: job.status,
      error: job.error?.message ?? null,
    })
  } catch (error) {
    deps.logger.warn({ voiceJobId: job.id, err: error }, '出来事を流せませんでした。画面の表示が古いままになることがあります')
  }
}
