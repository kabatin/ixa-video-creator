import type { ImageGenerationJob } from '@ixa/domain'
import { replaceManualStartFrame } from '@ixa/generation'
import type { ImageProcessorDeps } from './processor.js'

/**
 * つながりの最後に選んだ絵を当てる（ADR-0055 §6）。種類ごとに中身が違う:
 * - 開始フレーム: 手動の参照 `start_frame` を差し替える
 * - キャラクターシート: 識別画像の四面図に足す（四面図の主が無ければ主）。当てなかった試しは足さない
 * - キーアート: 何も変えない（もともと候補を並べるだけ。当てた印だけを残す）
 *
 * worker が当てたときは取り消しの記録を作らない（今までと同じ）。
 */
export const applyImage = async (
  deps: Pick<ImageProcessorDeps, 'shotReferences' | 'characters'>,
  job: ImageGenerationJob,
): Promise<void> => {
  const mediaAssetId = job.mediaAssetId
  if (mediaAssetId === null) throw new Error(`絵のジョブ ${job.id} には当てる絵がありません`)
  switch (job.kind) {
    case 'start_frame': {
      if (job.shotId === null) throw new Error(`絵のジョブ ${job.id} に Shot がありません`)
      await replaceManualStartFrame(deps.shotReferences, job.shotId, mediaAssetId)
      return
    }
    case 'character_sheet': {
      if (job.characterId === null) throw new Error(`絵のジョブ ${job.id} にキャラクターがありません`)
      const images = await deps.characters.listIdentityImages(job.characterId)
      if (images.some((image) => image.mediaAssetId === mediaAssetId)) return
      await deps.characters.addIdentityImage({
        characterId: job.characterId,
        mediaAssetId,
        role: 'four_view',
        // 四面図の主が無ければ主にする（生成の参照で優先される）。あれば足すだけ（気に入らなければ人が選び直す）。
        isPrimary: !images.some((image) => image.role === 'four_view' && image.isPrimary),
        order: images.length,
      })
      return
    }
    case 'key_art':
      return
  }
}
