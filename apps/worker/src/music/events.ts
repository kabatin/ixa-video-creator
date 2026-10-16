import type { MusicJob, ProjectEventPublisher } from '@ixa/domain'
import type { Logger } from 'pino'

/** 曲のジョブの状態を流す（ADR-0048）。**通知は上乗せ。** 落ちてもできた楽曲は取り消さない。 */
export const publishMusicJobStatus = async (
  deps: { readonly events: ProjectEventPublisher; readonly logger: Logger },
  job: MusicJob,
): Promise<void> => {
  try {
    await deps.events.publish({
      type: 'music_job.status',
      projectId: job.projectId,
      at: new Date().toISOString(),
      jobId: job.id,
      status: job.status,
      musicTrackIds: job.musicTrackIds,
      error: job.error?.message ?? null,
    })
  } catch (error) {
    deps.logger.warn({ musicJobId: job.id, err: error }, '出来事を流せませんでした。画面の表示が古いままになることがあります')
  }
}
