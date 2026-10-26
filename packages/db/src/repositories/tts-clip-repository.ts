import { and, eq } from 'drizzle-orm'
import { MediaAssetId, TtsClipId as TtsClipIdSchema, WorkspaceId, newId, type TtsClipId } from '@ixa/domain'
import { z } from 'zod'
import type { DbExecutor } from '../client.js'
import { ttsClips } from '../schema/dub.js'

/** 保存した読み上げ（ADR-0062）。声・読み方・文が同じなら読み直さない。 */
export const TtsClip = z.object({
  id: TtsClipIdSchema,
  /** 持ち主のワークスペース（別のワークスペースの読み上げは読まない）。 */
  workspaceId: WorkspaceId,
  /** sha256 の 16 進（64 字）。 */
  cacheKey: z.string().regex(/^[0-9a-f]{64}$/),
  mediaAssetId: MediaAssetId,
  durationSec: z.number().finite().positive(),
  costUsd: z.number().nonnegative(),
  createdAt: z.date(),
})
export type TtsClip = z.infer<typeof TtsClip>

export type CreateTtsClipInput = Omit<TtsClip, 'id' | 'createdAt'>

export type TtsClipRepository = {
  findByKey(workspaceId: WorkspaceId, cacheKey: string): Promise<TtsClip | null>
  /**
   * 保存する。**同じワークスペース・同じ鍵の行があれば、その行の素材・長さ・額を書き替える**（1 行のまま）。
   * 保存した素材が消されていて読み直したときに、付け替えるため（付け替えないと毎回払う）。
   */
  save(input: CreateTtsClipInput): Promise<TtsClip>
}

type TtsClipRow = typeof ttsClips.$inferSelect

const toDomain = (row: TtsClipRow): TtsClip => TtsClip.parse(row)

export const createTtsClipRepository = (db: DbExecutor): TtsClipRepository => {
  const findByKey = async (workspaceId: WorkspaceId, cacheKey: string): Promise<TtsClip | null> => {
    const row = (
      await db
        .select()
        .from(ttsClips)
        .where(and(eq(ttsClips.workspaceId, workspaceId), eq(ttsClips.cacheKey, cacheKey)))
        .limit(1)
    )[0]
    return row === undefined ? null : toDomain(row)
  }
  return {
    findByKey,
    async save(input) {
      const valid = TtsClip.omit({ id: true, createdAt: true }).parse(input)
      const id: TtsClipId = newId(TtsClipIdSchema)
      const rows = await db
        .insert(ttsClips)
        .values({ id, ...valid })
        .onConflictDoUpdate({
          target: [ttsClips.workspaceId, ttsClips.cacheKey],
          set: { mediaAssetId: valid.mediaAssetId, durationSec: valid.durationSec, costUsd: valid.costUsd },
        })
        .returning()
      const row = rows[0]
      if (row === undefined) throw new Error('tts_clips に保存できませんでした')
      return toDomain(row)
    },
  }
}
