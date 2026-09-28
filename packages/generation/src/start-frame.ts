import type { ShotReferenceRepository } from '@ixa/db'
import type { MediaAssetId, ShotId, ShotReference } from '@ixa/domain'

/**
 * Shot の「最初のフレーム」（ADR-0025）＝ 手で付けた `start_frame` の参照 1 枚。
 *
 * **API（手で付ける・外す）と worker（絵コンテの画像を作った後、ADR-0029）が同じ規則を使う。**
 * 書き写すと片方だけ直ってずれる（lessons L-016）。触るのは手で付けたものだけで、
 * 導かれた参照（前のカットの最後の 1 コマなど）には触らない。
 */
export type StartFrameReferences = Pick<ShotReferenceRepository, 'findByShot' | 'create' | 'delete'>

const manualStartFrames = async (references: StartFrameReferences, shotId: ShotId): Promise<ShotReference[]> =>
  (await references.findByShot(shotId)).filter(
    (reference) => reference.role === 'start_frame' && reference.sourceKind === 'manual',
  )

/** いまの最初のフレームの素材。無ければ null。 */
export const manualStartFrameOf = async (
  references: StartFrameReferences,
  shotId: ShotId,
): Promise<MediaAssetId | null> => (await manualStartFrames(references, shotId))[0]?.mediaAssetId ?? null

export const clearManualStartFrame = async (references: StartFrameReferences, shotId: ShotId): Promise<void> => {
  for (const reference of await manualStartFrames(references, shotId)) {
    await references.delete(reference.id)
  }
}

/** 差し替える（前の 1 枚を外してから付ける）。素材が画像かどうかは呼び出し側が確かめる。 */
export const replaceManualStartFrame = async (
  references: StartFrameReferences,
  shotId: ShotId,
  mediaAssetId: MediaAssetId,
): Promise<void> => {
  await clearManualStartFrame(references, shotId)
  await references.create({ shotId, mediaAssetId, role: 'start_frame', weight: 1, order: 0, sourceKind: 'manual' })
}
