import type { CreateSfxJobInput } from '@ixa/db'
import type { SfxJob } from '@ixa/domain'
import type { SfxGenerationDeps } from './deps.js'

/**
 * 効果音を作るジョブを始める（ADR-0052）。**ジョブを 1 行作って sfx キューへ入れるだけ。** 作るのは worker。
 */

/** 状態が変わったことを流す。**通知は上乗せ。** 落ちても頼んだことは取り消さない。 */
export const publishSfxJob = async (deps: Pick<SfxGenerationDeps, 'events' | 'logger'>, job: SfxJob): Promise<void> => {
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
    deps.logger.warn({ sfxJobId: job.id, err: error }, '出来事を流せませんでした')
  }
}

/**
 * ジョブを作ってキューへ入れる。**入れ損ねたら失敗にしてから投げる。** 待っているまま残すと、
 * 画面は「作っています」のまま二度と終わらない。
 */
export const startSfxJob = async (deps: SfxGenerationDeps, input: CreateSfxJobInput): Promise<SfxJob> => {
  const job = await deps.sfxJobs.create(input)
  try {
    await deps.sfxQueue.enqueue(job.id)
  } catch (error) {
    const failed = await deps.sfxJobs.markFailed(
      job.id,
      { code: 'enqueue_failed', message: '効果音を作る順番に入れられませんでした。もう一度押してください。', retryable: true },
      null,
    )
    await publishSfxJob(deps, failed)
    throw new Error('sfx キューへ入れられませんでした', { cause: error })
  }
  await publishSfxJob(deps, job)
  return job
}
