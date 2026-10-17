import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import type { MediaAssetRepository, ProjectRepository, ThumbnailRepository } from '@ixa/db'
import {
  MediaAssetId as MediaAssetIdSchema,
  ThumbnailJobData,
  newId,
  type MediaAssetId,
  type Project,
  type Thumbnail,
  type TimelineDocument,
} from '@ixa/domain'
import type { RenderThumbnailStill, ThumbnailBackgroundSource } from '@ixa/render'
import { mediaKey, type ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import { withoutUrls } from './redact.js'

/**
 * thumbnail キューのジョブ処理（ADR-0051）。
 *
 * 行を読む → 描いている にする → 背景の材料を揃える → `renderStill` で JPEG（2 MB 未満）→ 素材として保存 → 終わり。
 * - 背景がタイムラインのコマなら、**API が組んだ文書をジョブの中身で受け取る**（署名付き URL 入りなので DB に無い）
 * - 背景が画像なら、**描く直前に** URL を発行する（DB にもログにも出さない。規約 7）
 * - 冪等。終わった行はもう描かない
 * - 手元の書き出しフォルダには書かない（API の `syncRenderFolder` が入れる。ADR-0036）
 */

export type ThumbnailProcessorDeps = {
  readonly thumbnails: Pick<ThumbnailRepository, 'findById' | 'markRendering' | 'markDone' | 'markFailed'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById' | 'findByChecksum' | 'create'>
  readonly storage: Pick<ObjectStorage, 'put' | 'signedGetUrl'>
  /** `@ixa/render` の `renderThumbnailStill`。テストで Chrome を起こさないための差し込み口。 */
  readonly renderStill: RenderThumbnailStill
  /** JPEG を一時的に書く場所。 */
  readonly outputDir: string
  readonly mediaQueue: { readonly enqueue: (mediaAssetId: MediaAssetId) => Promise<void> }
  readonly logger: Logger
}

export type ThumbnailOutcome = { readonly state: 'succeeded' | 'failed' | 'skipped' | 'missing' }

/** 背景の画像の URL の有効期限。描くのは数秒なので短くてよい。 */
const IMAGE_URL_EXPIRES_SEC = 600

/** 利用者に見せる理由をそのまま持つ失敗。 */
class ThumbnailFailure extends Error {
  override readonly name = 'ThumbnailFailure'
}

const sourceFor = async (
  deps: ThumbnailProcessorDeps,
  thumbnail: Thumbnail,
  project: Project,
  timeline: TimelineDocument | null,
): Promise<ThumbnailBackgroundSource> => {
  const background = thumbnail.spec.background
  if (background.kind === 'timeline_frame') {
    if (timeline === null) {
      throw new ThumbnailFailure('タイムラインの中身が届いていません。もう一度書き出してください。')
    }
    return { kind: 'timeline_frame', doc: timeline }
  }
  const asset = await deps.mediaAssets.findById(background.mediaAssetId)
  if (asset === null || asset.projectId !== project.id) {
    throw new ThumbnailFailure('背景の画像が見つかりません。別の画像を選んでください。')
  }
  if (asset.kind !== 'image') {
    throw new ThumbnailFailure('背景に選んだ素材は画像ではありません。別の画像を選んでください。')
  }
  return { kind: 'image', url: await deps.storage.signedGetUrl(asset.storageKey, IMAGE_URL_EXPIRES_SEC) }
}

/**
 * JPEG を素材として保存する。**中身がまったく同じ素材が既にあれば、それを使う**（素材の表は同じ中身を 1 つしか
 * 持てない。同じ仕様で描き直すと同じバイト列になる。書き出しと同じ扱い）。
 */
const storeJpeg = async (
  deps: ThumbnailProcessorDeps,
  thumbnail: Thumbnail,
  project: Project,
  path: string,
): Promise<{ readonly id: MediaAssetId; readonly created: boolean }> => {
  const body = await readFile(path)
  const checksumSha256 = createHash('sha256').update(body).digest('hex')
  const existing = await deps.mediaAssets.findByChecksum(checksumSha256)
  if (existing !== null) {
    deps.logger.info(
      { thumbnailId: thumbnail.id, mediaAssetId: existing.id },
      '前のサムネイルと中身が同じだったので、前の素材をそのまま使います',
    )
    return { id: existing.id, created: false }
  }
  const id = newId(MediaAssetIdSchema)
  const storageKey = mediaKey(project.workspaceId, id, 'jpg')
  await deps.storage.put(storageKey, body, { contentType: 'image/jpeg' })
  await deps.mediaAssets.create({
    id,
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'image',
    storageKey,
    mimeType: 'image/jpeg',
    bytes: body.byteLength,
    checksumSha256,
    origin: { type: 'thumbnail', thumbnailId: thumbnail.id },
  })
  return { id, created: true }
}

/** 大きさ・プレビュー用の派生物を作る。**失敗してもサムネイルは落とさない**（後から流し直せる）。 */
const enqueueIngest = async (deps: ThumbnailProcessorDeps, thumbnail: Thumbnail, mediaAssetId: MediaAssetId) => {
  try {
    await deps.mediaQueue.enqueue(mediaAssetId)
  } catch (error) {
    deps.logger.error(
      { thumbnailId: thumbnail.id, mediaAssetId, err: withoutUrls(describe(error)) },
      'media キューへ投入できませんでした。サムネイルの派生物が作られていません',
    )
  }
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const draw = async (
  deps: ThumbnailProcessorDeps,
  thumbnail: Thumbnail,
  timeline: TimelineDocument | null,
): Promise<MediaAssetId> => {
  const project = await deps.projects.findById(thumbnail.projectId)
  if (project === null) throw new ThumbnailFailure('この作品は消されました。')
  await deps.thumbnails.markRendering(thumbnail.id)
  const source = await sourceFor(deps, thumbnail, project, timeline)
  const still = await deps.renderStill({ props: { spec: thumbnail.spec, source }, outputDir: deps.outputDir })
  try {
    const stored = await storeJpeg(deps, thumbnail, project, still.path)
    if (stored.created) await enqueueIngest(deps, thumbnail, stored.id)
    deps.logger.info(
      { thumbnailId: thumbnail.id, mediaAssetId: stored.id, bytes: still.bytes, jpegQuality: still.jpegQuality },
      'サムネイルを書き出しました',
    )
    return stored.id
  } finally {
    // 置き場に入れたら手元の JPEG は要らない。失敗しても片付ける。
    await rm(still.path, { force: true })
  }
}

export const processThumbnailJob = async (deps: ThumbnailProcessorDeps, data: unknown): Promise<ThumbnailOutcome> => {
  const { thumbnailId, timeline } = ThumbnailJobData.parse(data)
  const thumbnail = await deps.thumbnails.findById(thumbnailId)
  if (thumbnail === null) {
    deps.logger.warn({ thumbnailId }, 'サムネイルの行が見つかりません')
    return { state: 'missing' }
  }
  // 冪等性の要。終わった行は描き直さない（同じジョブが 2 回走っても素材を二重に作らない）。
  if (thumbnail.status === 'done' || thumbnail.status === 'failed') return { state: 'skipped' }

  try {
    const outputAssetId = await draw(deps, thumbnail, timeline)
    await deps.thumbnails.markDone(thumbnail.id, outputAssetId)
    return { state: 'succeeded' }
  } catch (error) {
    // **例外の文に署名付き URL が混ざりうる**（Chrome が読めなかった素材の URL など）。DB にもログにも出さない。
    const reason = withoutUrls(describe(error))
    const message = error instanceof ThumbnailFailure ? reason : `サムネイルを書き出せませんでした: ${reason}`
    deps.logger.error({ thumbnailId, err: reason }, 'サムネイルを書き出せませんでした')
    await deps.thumbnails.markFailed(thumbnail.id, message)
    return { state: 'failed' }
  }
}
