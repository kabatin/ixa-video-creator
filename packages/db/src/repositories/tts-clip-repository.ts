import { eq } from 'drizzle-orm'
import { MediaAssetId, TtsClipId as TtsClipIdSchema, newId, type TtsClipId } from '@ixa/domain'
import { z } from 'zod'
import type { DbExecutor } from '../client.js'
import { ttsClips } from '../schema/dub.js'

/** 保存した読み上げ（ADR-0062）。声・読み方・文が同じなら読み直さない。 */
export const TtsClip = z.object({
  id: TtsClipIdSchema,
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
  findByKey(cacheKey: string): Promise<TtsClip | null>
  /**
   * 保存する。**同じ鍵が先に入っていれば、先の行を返す**（同時に 2 つのジョブが同じ文を読んでも 1 行にする）。
   */
  save(input: CreateTtsClipInput): Promise<TtsClip>
}

type TtsClipRow = typeof ttsClips.$inferSelect

const toDomain = (row: TtsClipRow): TtsClip => TtsClip.parse(row)

export const createTtsClipRepository = (db: DbExecutor): TtsClipRepository => {
  const findByKey = async (cacheKey: string): Promise<TtsClip | null> => {
    const row = (await db.select().from(ttsClips).where(eq(ttsClips.cacheKey, cacheKey)).limit(1))[0]
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
        .onConflictDoNothing({ target: ttsClips.cacheKey })
        .returning()
      const row = rows[0]
      if (row !== undefined) return toDomain(row)
      const existing = await findByKey(valid.cacheKey)
      if (existing === null) throw new Error('tts_clips に保存できませんでした')
      return existing
    },
  }
}
