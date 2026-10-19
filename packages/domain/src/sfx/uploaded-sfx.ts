import { z } from 'zod'
import { MediaAssetId, ProjectId, UploadedSfxId } from '../common/ids.js'

/**
 * 手元のファイルから取り込んだ効果音（ADR-0056）。作った効果音（`SfxJob`）とは別の記録にする。
 * ジョブに混ぜると、作っていない音に作り物のきっかけ（英語の説明・10 秒までの長さ）を書くことになり、記録が嘘になる。
 * 効果音の段には置かない（置いていない候補）。素材ツリーの効果音に作った音と並べて出し、そこから段へ置く。
 */

/** 名前（ファイル名から拡張子を除いたもの）の上限。 */
export const UPLOADED_SFX_TITLE_MAX_LENGTH = 200

export const UploadedSfxTitle = z
  .string()
  .trim()
  .min(1, '効果音の名前を入れてください')
  .max(UPLOADED_SFX_TITLE_MAX_LENGTH, `効果音の名前は ${String(UPLOADED_SFX_TITLE_MAX_LENGTH)} 文字までです`)

export const UploadedSfx = z.object({
  id: UploadedSfxId,
  projectId: ProjectId,
  /** 音の実体。楽曲と同じく、上げたファイルの素材をそのまま指す。 */
  mediaAssetId: MediaAssetId,
  title: UploadedSfxTitle,
  createdAt: z.date(),
})
export type UploadedSfx = z.infer<typeof UploadedSfx>

export const CreateUploadedSfxInput = UploadedSfx.pick({ projectId: true, mediaAssetId: true, title: true })
export type CreateUploadedSfxInput = z.infer<typeof CreateUploadedSfxInput>
