import type { CreateVoiceJobInput } from '@ixa/db'
import type { VoiceJob } from '@ixa/domain'
import type { NarrationDeps } from './deps.js'

/**
 * 声のジョブを始める（ADR-0038）。**ジョブを 1 行作って voice キューへ入れるだけ。** 作るのは worker。
 */

/** 状態が変わったことを流す。**通知は上乗せ。** 落ちても頼んだことは取り消さない。 */
export const publishVoiceJob = async (deps: Pick<NarrationDeps, 'events' | 'logger'>, job: VoiceJob): Promise<void> => {
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
    deps.logger.warn({ voiceJobId: job.id, err: error }, '出来事を流せませんでした')
  }
}

/**
 * ジョブを作ってキューへ入れる。**入れ損ねたら失敗にしてから投げる。** 待っているまま残すと、
 * その行は「作っています」のまま二度と頼めなくなる。
 */
export const startVoiceJob = async (deps: NarrationDeps, input: CreateVoiceJobInput): Promise<VoiceJob> => {
  const job = await deps.voiceJobs.create(input)
  try {
    await deps.voiceQueue.enqueue(job.id)
  } catch (error) {
    const failed = await deps.voiceJobs.markFailed(
      job.id,
      { code: 'enqueue_failed', message: '声を作る順番に入れられませんでした。もう一度押してください。', retryable: true },
      null,
    )
    await publishVoiceJob(deps, failed)
    throw new Error('voice キューへ入れられませんでした', { cause: error })
  }
  await publishVoiceJob(deps, job)
  return job
}
