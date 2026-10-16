import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import type { CheckResult } from '../lib/wait-loop.js'
import { defineTool, Id, jsonResult } from '../tool-def.js'

/**
 * 曲を作る（`generate_music`）。**API 側は並行して実装中の契約**（2026-10-17 時点）:
 *
 *   POST /projects/{projectId}/music/generate
 *        { prompt, lyrics, durationSec 10–240, instrumental, seed?, count 1–4, title? } → 202 { jobId }
 *   GET  /music-jobs/{id} → { status, error, musicTrackIds }
 *
 * 契約が変わったらこのファイルだけ直せば済むよう、呼び出しと応答の形をここに閉じる。
 */

export const MUSIC_DURATION_MIN_SEC = 10
export const MUSIC_DURATION_MAX_SEC = 240

export const GenerateMusicInput = z.object({
  projectId: Id,
  prompt: z.string().min(1).max(2000).describe('Style/genre/mood/instrumentation of the song (English or Japanese).'),
  lyrics: z
    .string()
    .max(5000)
    .default('')
    .describe('Lyrics with section tags like [verse] [chorus]. Empty for instrumental.'),
  durationSec: z.number().min(MUSIC_DURATION_MIN_SEC).max(MUSIC_DURATION_MAX_SEC),
  instrumental: z.boolean().default(false),
  seed: z.number().int().min(0).optional(),
  count: z.number().int().min(1).max(4).default(1).describe('How many alternative songs to make.'),
  title: z.string().min(1).max(200).optional().describe('Track title shown in ixa (Japanese is fine).'),
})

const WireMusicJobStarted = z.object({ jobId: z.string() })

const WireMusicJob = z.object({
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  error: z.string().nullable(),
  musicTrackIds: z.array(z.string()),
})

export const musicJobCheck = async (api: ApiClient, jobId: string): Promise<CheckResult> => {
  const job = await api.get(`/music-jobs/${seg(jobId)}`, WireMusicJob)
  if (job.status === 'queued' || job.status === 'running') {
    return { state: 'pending', detail: { status: job.status } }
  }
  if (job.status === 'succeeded') return { state: 'succeeded', detail: { musicTrackIds: job.musicTrackIds } }
  return { state: job.status, detail: { error: job.error } }
}

export const generateMusicTool = defineTool({
  name: 'generate_music',
  description:
    'Compose a new song for the project with the local music AI (submit only; takes minutes). ' +
    'Returns a music jobId; then call wait with {kind:"music", id} — when it succeeds you get musicTrackIds. ' +
    'Pick one with set_master_track, which also starts the beat analysis. ' +
    'Track titles are shown to the user in Japanese UI, so Japanese titles are preferred.',
  input: GenerateMusicInput,
  handler: async (args, deps) => {
    const { projectId, ...body } = args
    const started = await deps.api.post(
      `/projects/${seg(projectId)}/music/generate`,
      body,
      WireMusicJobStarted,
    )
    return jsonResult({ jobId: started.jobId, next: { tool: 'wait', jobs: [{ kind: 'music', id: started.jobId }] } })
  },
})
