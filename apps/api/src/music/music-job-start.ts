import type { CreateMusicJobInput } from '@ixa/db'
import type { MusicJob } from '@ixa/domain'
import type { MusicGenerationDeps } from './deps.js'

/**
 * 曲を作るジョブを始める（ADR-0048）。**ジョブを 1 行作って music キューへ入れるだけ。** 作るのは worker。
 */

/** 状態が変わったことを流す。**通知は上乗せ。** 落ちても頼んだことは取り消さない。 */
export const publishMusicJob = async (
  deps: Pick<MusicGenerationDeps, 'events' | 'logger'>,
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
    deps.logger.warn({ musicJobId: job.id, err: error }, '出来事を流せませんでした')
  }
}

/**
 * ジョブを作ってキューへ入れる。**入れ損ねたら失敗にしてから投げる。** 待っているまま残すと、
 * 画面は「作っています」のまま二度と終わらない。
 */
export const startMusicJob = async (deps: MusicGenerationDeps, input: CreateMusicJobInput): Promise<MusicJob> => {
  const job = await deps.musicJobs.create(input)
  try {
    await deps.musicQueue.enqueue(job.id)
  } catch (error) {
    const failed = await deps.musicJobs.markFailed(
      job.id,
      { code: 'enqueue_failed', message: '曲を作る順番に入れられませんでした。もう一度押してください。', retryable: true },
      null,
    )
    await publishMusicJob(deps, failed)
    throw new Error('music キューへ入れられませんでした', { cause: error })
  }
  await publishMusicJob(deps, job)
  return job
}
