import type { MediaAssetRepository } from '@ixa/db'
import type { CreateMediaAssetInput, MediaAsset, MediaAssetId } from '@ixa/domain'
import type { Logger } from './logger.js'

/**
 * 置き場に入れたファイルを素材（MediaAsset）として登録し、取り込みジョブ（ffprobe / プロキシ / サムネ / ポスター）を
 * 投げる。アップロードの完了（`POST /uploads/complete`）と同梱の見本（ADR-0067）が同じ道を通る
 * （見本の絵も、アップロードした後と同じようにサムネイルができる）。
 */

/** BullMQ のキュー名（docs/ARCHITECTURE.md §20）。apps 同士を import しないため定数で持つ。 */
export const MEDIA_QUEUE_NAME = 'media'

/**
 * 取り込みジョブ（ffprobe / プロキシ / サムネ / ポスター）をキューへ投入する Port。
 * Redis への依存を main.ts に閉じ込める。
 */
export type MediaQueue = {
  /** ジョブデータは ID のみ。実データは DB から読む（ADR-0008）。 */
  enqueue(mediaAssetId: MediaAssetId): Promise<void>
}

/**
 * media キューへの投入口。
 * キューとロガーを 1 つのオブジェクトにまとめてあるのは、キューだけ配線して
 * 投入失敗を握り潰す配線を型の上で作れなくするため（CLAUDE.md 規約 5）。
 */
export type MediaIngestDeps = {
  readonly queue: MediaQueue
  readonly logger: Logger
}

export type MediaIntakeDeps = {
  readonly mediaAssets: Pick<MediaAssetRepository, 'findByChecksum' | 'create'>
  /** 未配線のときは登録だけ行い queued=false を返す。 */
  readonly mediaIngest?: MediaIngestDeps
}

export type RegisteredMediaAsset = {
  readonly asset: MediaAsset
  /** false は、同じ中身の素材が先にあった（それを返す。キューへは入れ直さない）。 */
  readonly created: boolean
  /** 取り込みジョブを投げられたか。 */
  readonly queued: boolean
}

/**
 * 取り込みジョブをキューへ投入する。
 * 投入に失敗しても素材の登録自体は成功しているため throw しないが、
 * 握り潰さずにログへ残し、queued=false として呼び出し側にも伝える（CLAUDE.md 規約 5）。
 */
const enqueueIngest = async (ingest: MediaIngestDeps | undefined, mediaAssetId: MediaAssetId): Promise<boolean> => {
  if (ingest === undefined) {
    return false
  }
  try {
    await ingest.queue.enqueue(mediaAssetId)
    return true
  } catch (error) {
    ingest.logger.error(
      { mediaAssetId, queue: MEDIA_QUEUE_NAME, err: error },
      'media キューへの取り込みジョブ投入に失敗しました',
    )
    return false
  }
}

/** 同じ中身（checksum）の素材があればそれを返し、無ければ登録して取り込みジョブを投げる。 */
export const registerMediaAsset = async (
  deps: MediaIntakeDeps,
  input: CreateMediaAssetInput,
): Promise<RegisteredMediaAsset> => {
  // 重複排除。同じ内容のファイルを二重に登録しない。
  const duplicate = await deps.mediaAssets.findByChecksum(input.checksumSha256)
  if (duplicate !== null) {
    // 既存の素材は取り込み済み（または取り込み中）なので、キューへ入れ直さない。
    return { asset: duplicate, created: false, queued: false }
  }
  const created = await deps.mediaAssets.create(input)
  // 投入に失敗しても登録は成功している（docs/ARCHITECTURE.md §7）。
  const queued = await enqueueIngest(deps.mediaIngest, created.id)
  return { asset: created, created: true, queued }
}
