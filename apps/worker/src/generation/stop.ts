import type { GenerationJobRepository } from '@ixa/db'
import type { GenerationJob, GenerationJobId } from '@ixa/domain'
import type { ProviderJobHandle, ProviderRegistry } from '@ixa/provider-core'
import type { Logger } from 'pino'

/**
 * 生成をやめる・終える口（制作者 2026-10-01「動画生成をキャンセル出来るようにしたい」）。
 *
 * API はジョブの行を取り消しにするだけで、worker の 1 回分の処理はその間も進んでいる。
 * **書く直前に読み直し**、取り消されていれば Take にしない・状態を上書きしない。
 */

/** 制作者が生成をやめたか。読めなければ投げる（読めないまま書き進めない）。 */
export const cancelledSince = async (
  jobs: Pick<GenerationJobRepository, 'findById'>,
  jobId: GenerationJobId,
): Promise<boolean> => (await jobs.findById(jobId))?.status === 'cancelled'

/**
 * 生成先へ止めてと頼む。**届かなくても投げない**（取り消し・失敗はもう決まっている）。
 * 届かなかったことはログに残す（生成先で動き続けているかもしれない）。
 */
export const stopAtProvider = async (
  deps: { readonly registry: ProviderRegistry; readonly logger: Logger },
  handle: ProviderJobHandle,
  jobId: GenerationJobId,
): Promise<void> => {
  try {
    await deps.registry.providerFor(handle.modelId).cancel(handle)
  } catch (error) {
    deps.logger.warn(
      { err: error, jobId, providerId: handle.providerId, ref: handle.ref },
      '生成先へ止めてと頼めませんでした。生成先で動き続けているかもしれません',
    )
  }
}

/**
 * 失敗で終えたジョブを、生成先でも止める（PR #4 レビュー #4）。問い合わせの上限で諦めても、
 * vpipe は作り続けて唯一の GPU を占める。生成先へ送っていなければ頼む相手が無い。
 *
 * **応答が失われた投入**（送ったが ID が返らなかった）のあとで諦めたときは、生成先の ID が分からず止められない
 * （vpipe-api に冪等キーで引く口が無い）。
 */
export const stopAbandonedJob = async (
  deps: { readonly registry: ProviderRegistry; readonly logger: Logger },
  job: GenerationJob,
): Promise<void> => {
  if (job.providerJobRef === null || job.resolvedModel === null) return
  const model = (() => {
    try {
      return job.resolvedModel === null ? null : deps.registry.findModel(job.resolvedModel)
    } catch {
      return null
    }
  })()
  if (model === null) {
    deps.logger.warn(
      { jobId: job.id, modelId: job.resolvedModel },
      '登録の無いモデルなので、生成先へ止めてと頼めませんでした',
    )
    return
  }
  await stopAtProvider(
    deps,
    {
      providerId: model.providerId,
      modelId: model.id,
      ref: job.providerJobRef,
      submittedAt: job.startedAt ?? job.queuedAt,
    },
    job.id,
  )
}
