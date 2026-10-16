import { z } from 'zod'
import { MusicJobId, MusicTrackId, ProjectId } from '../common/ids.js'
import { Seconds } from '../common/time.js'

/**
 * 曲を作るジョブ（ADR-0048）。worker のキュー `music` で 1 つずつ動かす（手元の GPU を使う）。
 *
 * 1 つのジョブで最大 4 曲作り、できた曲はそれぞれ楽曲（MusicTrack）になる。
 * 声のジョブと同じく、ジョブの行は状態の記録で、出来上がりは楽曲の側にある。
 */

/** 曲調（スタイルのタグ）の上限。ace-step-api の契約と同じ。 */
export const MUSIC_PROMPT_MAX_LENGTH = 1000
/** 歌詞の上限。ace-step-api の契約と同じ。 */
export const MUSIC_LYRICS_MAX_LENGTH = 4000
/** 曲の長さ（秒）。ace-step-api の契約と同じ。 */
export const MUSIC_DURATION_MIN_SEC = 10
export const MUSIC_DURATION_MAX_SEC = 240
/** 1 つのジョブで作る曲の数。 */
export const MUSIC_COUNT_MAX = 4

export const MusicJobSpec = z.object({
  /** 曲調（スタイルのタグ。例: `j-pop, upbeat, female vocal`）。 */
  prompt: z.string().trim().min(1).max(MUSIC_PROMPT_MAX_LENGTH),
  /** 歌詞。空なら歌詞なし。`[verse]` `[chorus]` の印を含めてよい。 */
  lyrics: z.string().max(MUSIC_LYRICS_MAX_LENGTH),
  durationSec: Seconds.min(MUSIC_DURATION_MIN_SEC).max(MUSIC_DURATION_MAX_SEC),
  /** 歌なし。true なら歌詞は使わない。 */
  instrumental: z.boolean(),
  /** 同じ曲を作り直すための種。省略は毎回違う曲。 */
  seed: z.number().int().nonnegative().nullable(),
  count: z.number().int().min(1).max(MUSIC_COUNT_MAX),
  /** 楽曲の名前。省略は曲調から付ける。 */
  title: z.string().trim().min(1).max(200).nullable(),
})
export type MusicJobSpec = z.infer<typeof MusicJobSpec>

export const MusicJobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
export type MusicJobStatus = z.infer<typeof MusicJobStatus>

export const MusicJobError = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
})
export type MusicJobError = z.infer<typeof MusicJobError>

export const MusicJob = z.object({
  id: MusicJobId,
  projectId: ProjectId,
  /** 使う AI（曲の AI）。 */
  tool: z.string().min(1),
  model: z.string().nullable(),
  spec: MusicJobSpec,
  status: MusicJobStatus,
  error: MusicJobError.nullable(),
  /** 調べるための記録（生成先のジョブ・かかった時間）。鍵と URL は入れない。 */
  providerRecord: z.record(z.unknown()).nullable(),
  /** できた楽曲。成功するまで空。 */
  musicTrackIds: z.array(MusicTrackId),
  queuedAt: z.date(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
})
export type MusicJob = z.infer<typeof MusicJob>

/** 終わったジョブか（もう状態が変わらない）。 */
export const isMusicJobFinished = (status: MusicJobStatus): boolean =>
  status === 'succeeded' || status === 'failed' || status === 'cancelled'

/** 楽曲の名前。指定が無ければ曲調の頭から付け、複数曲なら番号を足す。 */
export const musicTrackTitle = (spec: MusicJobSpec, index: number): string => {
  const base = spec.title ?? spec.prompt.slice(0, 40).trim()
  return spec.count > 1 ? `${base} ${String(index + 1)}` : base
}
