import { MusicJobStatus, type AiToolId, type ProjectId } from '@ixa/domain'
import { z } from 'zod'
import { createAiSettingsApi } from '@/lib/ai-settings-api'
import type { Requester } from '@/lib/requester'

/**
 * 曲を作る（ADR-0048）の呼び出し口。手元の ACE-Step 1.5 で作り、できた曲はそれぞれ楽曲になる。
 *
 * 作るのは時間が掛かる（ジョブ）。頼んだ口は受け付けたことしか返さないので、
 * 出来事（`music_job.status`）が届いたら一覧を引き直す。
 */

/** 曲を作るジョブ。**理由の文は worker が利用者向けに書いたもの**（URL や例外の本文は入らない）。 */
export const WireMusicJob = z.object({
  id: z.string(),
  status: MusicJobStatus,
  prompt: z.string(),
  /** 送った歌詞（プロンプトビューア）。前の API には無い。 */
  lyrics: z.string().optional(),
  seed: z.number().int().nullable().optional(),
  durationSec: z.number(),
  instrumental: z.boolean(),
  count: z.number().int(),
  title: z.string().nullable(),
  musicTrackIds: z.array(z.string()),
  error: z.string().nullable(),
  queuedAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type WireMusicJob = z.infer<typeof WireMusicJob>

const WireMusicJobList = z.array(WireMusicJob)
const WireMusicJobAccepted = z.object({ jobId: z.string() })
export type WireMusicJobAccepted = z.infer<typeof WireMusicJobAccepted>
const WireMusicJobsCancelled = z.object({ cancelledJobIds: z.array(z.string()) })
export type WireMusicJobsCancelled = z.infer<typeof WireMusicJobsCancelled>

/** 頼むときの本文（API の検証と同じ形）。省略したものは API の既定になる。 */
export type MusicGenerateBody = {
  readonly prompt: string
  readonly lyrics: string
  readonly durationSec: number
  readonly instrumental: boolean
  readonly count: number
}

export type MusicJobApi = {
  /** 曲を作り始める。曲の AI が使えなければ 409（理由の文はそのまま見せる）。 */
  generateMusic: (projectId: ProjectId, body: MusicGenerateBody) => Promise<WireMusicJobAccepted>
  /** 最近のジョブ（新しい順・最大 20 件）。 */
  listMusicJobs: (projectId: ProjectId) => Promise<WireMusicJob[]>
  /** 待っている・作っているジョブをまとめて止める。 */
  cancelMusicJobs: (projectId: ProjectId) => Promise<WireMusicJobsCancelled>
  /** 「使う AI」で選んでいる曲の AI（歌えるか・長さの上限が AI ごとに違う）。 */
  musicTool: () => Promise<AiToolId>
}

const projectPath = (projectId: ProjectId, suffix: string): string =>
  `/projects/${encodeURIComponent(projectId)}${suffix}`

export const createMusicJobApi = (requester: Requester): MusicJobApi => ({
  generateMusic: async (projectId, body) =>
    requester.post(projectPath(projectId, '/music/generate'), body, WireMusicJobAccepted),
  listMusicJobs: async (projectId) =>
    requester.get(projectPath(projectId, '/music-jobs'), WireMusicJobList),
  cancelMusicJobs: async (projectId) =>
    requester.post(projectPath(projectId, '/music-jobs/cancel'), undefined, WireMusicJobsCancelled),
  musicTool: async () => (await createAiSettingsApi(requester).getAiSettings()).settings.music,
})
