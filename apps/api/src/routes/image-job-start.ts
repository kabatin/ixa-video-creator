import type { CreateImageJobInput, ImageJobRepository } from '@ixa/db'
import type { ImageGenerationJob, ImageGenerationJobId, ProjectEventPublisher } from '@ixa/domain'
import type { Logger } from 'pino'

/**
 * 絵を作るジョブを始める（ADR-0029）。最初のフレーム（Shot）とキャラクターシート（ADR-0035）が同じ道を通る。
 * **ジョブを 1 行作って image キューへ入れるだけ。** 作るのは worker（Codex は 1 度に 1 枚なので順番待ちも共有）。
 */

export type ImageJobQueue = { readonly enqueue: (imageJobId: ImageGenerationJobId) => Promise<void> }

export type ImageJobStartDeps = {
  readonly imageJobs: Pick<ImageJobRepository, 'create' | 'markFailed'>
  readonly imageQueue: ImageJobQueue
  readonly events: ProjectEventPublisher
  readonly logger: Logger
}

/** 状態が変わったことを流す。**通知は上乗せ。** 落ちても頼んだことは取り消さない（ProjectEventPublisher の約束）。 */
export const publishImageJob = async (
  deps: Pick<ImageJobStartDeps, 'events' | 'logger'>,
  job: ImageGenerationJob,
): Promise<void> => {
  try {
    await deps.events.publish({
      type: 'image_job.status',
      projectId: job.projectId,
      at: new Date().toISOString(),
      shotId: job.shotId,
      characterId: job.characterId,
      jobId: job.id,
      status: job.status,
      error: job.error?.message ?? null,
    })
  } catch (error) {
    deps.logger.warn({ imageJobId: job.id, err: error }, '出来事を流せませんでした')
  }
}

/**
 * ジョブを作ってキューへ入れる。**入れ損ねたら失敗にしてから投げる。** 待っているまま残すと、
 * その Shot・キャラクターは「作っています」のまま二度と頼めなくなる。
 */
export const startImageJob = async (deps: ImageJobStartDeps, input: CreateImageJobInput): Promise<ImageGenerationJob> => {
  const job = await deps.imageJobs.create(input)
  try {
    await deps.imageQueue.enqueue(job.id)
  } catch (error) {
    const failed = await deps.imageJobs.markFailed(
      job.id,
      { code: 'enqueue_failed', message: '絵を作る順番に入れられませんでした。もう一度押してください。', retryable: true },
      null,
    )
    await publishImageJob(deps, failed)
    throw new Error('image キューへ入れられませんでした', { cause: error })
  }
  await publishImageJob(deps, job)
  return job
}
