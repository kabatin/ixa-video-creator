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

type FrameRole = Extract<ShotReference['role'], 'start_frame' | 'end_frame'>

const manualFrames = async (
  references: Pick<StartFrameReferences, 'findByShot'>,
  shotId: ShotId,
  role: FrameRole,
): Promise<ShotReference[]> =>
  (await references.findByShot(shotId)).filter(
    (reference) => reference.role === role && reference.sourceKind === 'manual',
  )

const frameOf = async (
  references: Pick<StartFrameReferences, 'findByShot'>,
  shotId: ShotId,
  role: FrameRole,
): Promise<MediaAssetId | null> => (await manualFrames(references, shotId, role))[0]?.mediaAssetId ?? null

const clearFrame = async (references: StartFrameReferences, shotId: ShotId, role: FrameRole): Promise<void> => {
  for (const reference of await manualFrames(references, shotId, role)) {
    await references.delete(reference.id)
  }
}

const replaceFrame = async (
  references: StartFrameReferences,
  shotId: ShotId,
  role: FrameRole,
  mediaAssetId: MediaAssetId,
): Promise<void> => {
  await clearFrame(references, shotId, role)
  await references.create({ shotId, mediaAssetId, role, weight: 1, order: 0, sourceKind: 'manual' })
}

/** いまの最初のフレームの素材。無ければ null。 */
export const manualStartFrameOf = async (
  references: Pick<StartFrameReferences, 'findByShot'>,
  shotId: ShotId,
): Promise<MediaAssetId | null> => frameOf(references, shotId, 'start_frame')

export const clearManualStartFrame = async (references: StartFrameReferences, shotId: ShotId): Promise<void> =>
  clearFrame(references, shotId, 'start_frame')

/** 差し替える（前の 1 枚を外してから付ける）。素材が画像かどうかは呼び出し側が確かめる。 */
export const replaceManualStartFrame = async (
  references: StartFrameReferences,
  shotId: ShotId,
  mediaAssetId: MediaAssetId,
): Promise<void> => replaceFrame(references, shotId, 'start_frame', mediaAssetId)

/**
 * 終わりの画像（2026-10-24）＝ 手で付けた `end_frame` の参照 1 枚。動画の最後のコマになる。
 * 規則は最初のフレームと同じ（手で付けたものだけを触る）。
 */
export const manualEndFrameOf = async (
  references: Pick<StartFrameReferences, 'findByShot'>,
  shotId: ShotId,
): Promise<MediaAssetId | null> => frameOf(references, shotId, 'end_frame')

export const clearManualEndFrame = async (references: StartFrameReferences, shotId: ShotId): Promise<void> =>
  clearFrame(references, shotId, 'end_frame')

export const replaceManualEndFrame = async (
  references: StartFrameReferences,
  shotId: ShotId,
  mediaAssetId: MediaAssetId,
): Promise<void> => replaceFrame(references, shotId, 'end_frame', mediaAssetId)
