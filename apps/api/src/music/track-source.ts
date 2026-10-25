import { z } from '@hono/zod-openapi'
import type { MusicJob, MusicTrackId } from '@ixa/domain'

/**
 * 楽曲を作ったときの頼み方（プロンプトビューア。制作者 2026-10-25）。AI で作った曲だけが持つ。
 * 楽曲の側はジョブを指していないので、ジョブの `musicTrackIds` から引き当てる。
 */
export const MusicTrackSource = z
  .object({
    /** 曲調（AI へ送った文そのもの）。 */
    prompt: z.string(),
    /** 歌詞（送った文そのもの）。歌なし・歌詞なしは空。 */
    lyrics: z.string(),
    instrumental: z.boolean(),
    /** 頼んだ種。null は毎回違う曲（種を決めずに頼んだ）。 */
    seed: z.number().int().nullable(),
    durationSec: z.number(),
    /** 使った AI とモデル。 */
    tool: z.string(),
    model: z.string().nullable(),
    /** 作り終えた日時。 */
    createdAt: z.string().datetime(),
  })
  .openapi('MusicTrackSource')
export type MusicTrackSource = z.infer<typeof MusicTrackSource>

/**
 * その曲を作ったジョブを探して頼み方を返す。持ち込んだ曲・見つからなければ null。
 * 同じ曲を指すジョブが 2 つあることは無いが、あれば先に渡されたもの（新しい順なら新しい方）を使う。
 */
export const musicTrackSourceOf = (trackId: MusicTrackId, jobs: readonly MusicJob[]): MusicTrackSource | null => {
  const job = jobs.find((candidate) => candidate.musicTrackIds.includes(trackId))
  if (job === undefined) return null
  return {
    prompt: job.spec.prompt,
    lyrics: job.spec.lyrics,
    instrumental: job.spec.instrumental,
    seed: job.spec.seed,
    durationSec: job.spec.durationSec,
    tool: job.tool,
    model: job.model,
    createdAt: (job.finishedAt ?? job.queuedAt).toISOString(),
  }
}
