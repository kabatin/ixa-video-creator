import {
  MUSIC_COUNT_MAX,
  MUSIC_DURATION_MAX_SEC,
  MUSIC_DURATION_MIN_SEC,
  MUSIC_LYRICS_MAX_LENGTH,
  MUSIC_PROMPT_MAX_LENGTH,
  MusicJobStatus,
} from '@ixa/domain'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import type { CheckResult } from '../lib/wait-loop.js'
import { defineTool, Id, jsonResult, SEED_MAX } from '../tool-def.js'

/**
 * 曲を作る（`generate_music`。ADR-0048 の API: apps/api/src/routes/music-generate.ts）:
 *
 *   POST /projects/{projectId}/music/generate
 *        { prompt, lyrics, durationSec 10–240, instrumental, seed?, count 1–4, title? } → 202 { jobId }
 *   GET  /music-jobs/{id} → { status, error, musicTrackIds }
 *
 * 上限は domain の定数を読む（写さない）。呼び出しと応答の形はこのファイルに閉じる。
 */

export const GenerateMusicInput = z.object({
  projectId: Id,
  prompt: z.string().trim().min(1).max(MUSIC_PROMPT_MAX_LENGTH).describe('Style/genre/mood/instrumentation of the song (English or Japanese).'),
  lyrics: z
    .string()
    .max(MUSIC_LYRICS_MAX_LENGTH)
    .default('')
    .describe('Lyrics with section tags like [verse] [chorus]. Empty for instrumental.'),
  durationSec: z.number().min(MUSIC_DURATION_MIN_SEC).max(MUSIC_DURATION_MAX_SEC).default(60),
  instrumental: z.boolean().default(false),
  seed: z.number().int().min(0).max(SEED_MAX).optional(),
  count: z.number().int().min(1).max(MUSIC_COUNT_MAX).default(1).describe('How many alternative songs to make.'),
  title: z.string().trim().min(1).max(200).optional().describe('Track title shown in ixa (Japanese is fine).'),
})

const WireMusicJobStarted = z.object({ jobId: z.string() })

const WireMusicJob = z.object({
  status: MusicJobStatus,
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
    'Which AI is used comes from the user\'s AI settings (music): stable_audio_medium_music (the default) makes instrumental BGM only ' +
    '(instrumental:true, no lyrics, 10–190 s, English prompt); ace_step sings or plays instrumental (10–240 s). ' +
    'A vocal request (instrumental:false) while Stable Audio is selected is routed to ace_step when it is available, ' +
    'otherwise rejected with 409; lyrics with instrumental:true are rejected, never silently dropped. ' +
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
