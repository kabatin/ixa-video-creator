import type { GenerationJobRepository } from '@ixa/db'
import type { GenerationJobId } from '@ixa/domain'
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
