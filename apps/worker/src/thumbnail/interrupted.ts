import type { ThumbnailRepository } from '@ixa/db'
import { ThumbnailJobData } from '@ixa/domain'
import type { Logger } from 'pino'
import { withoutUrls } from './redact.js'

const INTERRUPTED_MESSAGE = '描いている途中で処理が止まりました。もう一度書き出してください。'

/**
 * キューが**処理の外で**ジョブを打ち切ったとき（worker が落ちた・止まりすぎ）、行を失敗にする。
 * `processThumbnailJob` は失敗を自分で行に書くので、thumbnail キューの `failed` はここにしか来ない。
 * 書かないと行は「描いています」のまま残り、画面は待ち続ける（絵のジョブと同じ。`image/interrupted.ts`）。
 *
 * **投げない。** ここは出来事の受け口で、投げても誰も拾えない。キューの理由は URL を抜いてから残す。
 */
export const failInterruptedThumbnailJob = async (
  deps: {
    readonly thumbnails: Pick<ThumbnailRepository, 'findById' | 'markFailed'>
    readonly logger: Logger
  },
  data: unknown,
  queueReason: string,
): Promise<void> => {
  const reason = withoutUrls(queueReason)
  try {
    // 文書（署名付き URL 入り）は読まない。ID だけを拾う。
    const parsed = ThumbnailJobData.pick({ thumbnailId: true }).safeParse(data)
    if (!parsed.success) {
      deps.logger.error({ queueReason: reason }, '打ち切られたサムネイルのジョブのデータが読めません')
      return
    }
    const thumbnail = await deps.thumbnails.findById(parsed.data.thumbnailId)
    if (thumbnail === null || thumbnail.status === 'done' || thumbnail.status === 'failed') return
    deps.logger.error(
      { thumbnailId: thumbnail.id, queueReason: reason },
      'サムネイルのジョブがキューに打ち切られました。失敗にします',
    )
    await deps.thumbnails.markFailed(thumbnail.id, INTERRUPTED_MESSAGE)
  } catch (error) {
    deps.logger.error({ err: withoutUrls(String(error)), queueReason: reason }, '打ち切られたサムネイルを失敗にできませんでした')
  }
}
