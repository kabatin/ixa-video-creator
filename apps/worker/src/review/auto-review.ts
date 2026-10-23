import type { TakeRepository } from '@ixa/db'
import { shouldAutoReview, type MediaAsset, type TakeId } from '@ixa/domain'
import type { Logger } from 'pino'

/**
 * 自動の作り直しを選んだ Take は、取り込み（ポスターフレーム）が済んだら自動でレビューを積む（ADR-0057。夜間の自走）。
 * レビューはポスターフレームを見るので、生成の直後ではなく media の取り込みの後に積む。
 * 選んでいなければ積まない（既定。レビューは人が頼む）。NG なら review → regeneration が上限まで作り直し、
 * 作り直した Take も同じ選択を引き継いで、またここへ来る。
 */
export const reviewWhenAutoRetake =
  (deps: {
    readonly takes: Pick<TakeRepository, 'findById'>
    readonly reviewQueue: { readonly enqueue: (takeId: TakeId) => Promise<void> }
    readonly logger: Logger
  }) =>
  async (asset: MediaAsset): Promise<void> => {
    if (asset.origin.type !== 'generated') return
    const take = await deps.takes.findById(asset.origin.takeId)
    if (take === null || !shouldAutoReview(take)) return
    await deps.reviewQueue.enqueue(take.id)
    deps.logger.info({ takeId: take.id }, '自動の作り直しを選んだ Take なので、レビューを積みました')
  }
