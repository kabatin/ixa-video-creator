import { SFX_COUNT_MAX, SfxCue, SfxJobStatus } from '@ixa/domain'
import { z } from 'zod'
import { IxaApiError, seg } from '../api-client.js'
import type { CheckResult } from '../lib/wait-loop.js'
import { defineTool, Id, jsonResult, mapLimited, round, SEED_MAX } from '../tool-def.js'
import type { ApiClient } from '../api-client.js'

/**
 * 効果音（ADR-0052 の API: apps/api/src/routes/sfx-generate.ts）:
 *
 *   POST /projects/{projectId}/sfx/generate { cues[], count 1–4, seed?, tool? } → 202 { jobIds }
 *   GET  /sfx-jobs/{id} → { status, error, timelineClipId, mediaAssetIds }
 *   GET  /projects/{projectId}/sfx/suggestions → [{ kind, reason, cue }]
 *
 * きっかけの範囲は domain の `SfxCue` を読む（写さない）。置いた音は SFX の段の media クリップ。
 */

/** 1 回に頼めるきっかけの数（API と同じ）。 */
const MAX_CUES = 30

export const GenerateSfxInput = z.object({
  projectId: Id,
  cues: z
    .array(SfxCue)
    .min(1)
    .max(MAX_CUES)
    .describe(
      'Where and what: startSec (timeline seconds), durationSec 0.5–10, prompt (ENGLISH sound description, ' +
        'e.g. "car engine revving, tires screeching"), volume 0–2 (default 0.8).',
    ),
  model: z
    .enum(['stable_audio_sfx', 'moss_sfx'])
    .optional()
    .describe(
      "Default: the selected sound-effect AI (set_ai purpose sfx). stable_audio_sfx is the main one (well under a " +
        'second per clip); moss_sfx is a slow fallback (minutes per clip) — use it only if Stable Audio is unavailable.',
    ),
  count: z.number().int().min(1).max(SFX_COUNT_MAX).default(1).describe('Variants per cue. The first is placed; others stay as assets.'),
  seed: z
    .number()
    .int()
    .min(0)
    .max(SEED_MAX)
    .optional()
    .describe('Variant i uses seed + 2i. To reproduce one clip exactly, send its seed with count 1.'),
})

const WireSfxJobsStarted = z.object({ jobIds: z.array(z.string()) })

const WireSfxJob = z.object({
  status: SfxJobStatus,
  error: z.string().nullable(),
  timelineClipId: z.string().nullable(),
  mediaAssetIds: z.array(z.string()),
})

export const sfxJobCheck = async (api: ApiClient, jobId: string): Promise<CheckResult> => {
  const job = await api.get(`/sfx-jobs/${seg(jobId)}`, WireSfxJob)
  if (job.status === 'queued' || job.status === 'running') return { state: 'pending', detail: { status: job.status } }
  if (job.status === 'succeeded') {
    return { state: 'succeeded', detail: { timelineClipId: job.timelineClipId, mediaAssetIds: job.mediaAssetIds } }
  }
  return { state: job.status, detail: { error: job.error } }
}

export const generateSfxTool = defineTool({
  name: 'generate_sfx',
  description:
    'Make sound effects with the local text-to-audio AI and place them on the timeline SFX track (submit only). ' +
    'The model does NOT see the video, so you decide when each sound plays: give cues with timeline startSec, ' +
    'durationSec and an English prompt. Get cue ideas from suggest_sfx (effects/transitions), and add shot-content ' +
    'sounds yourself (engine, tires, rain, crowd) from the shot descriptions. Returns jobIds; then call wait with ' +
    '{kind:"sfx", id} per job. Check placed sounds with list_sfx and remove with remove_sfx.',
  input: GenerateSfxInput,
  handler: async ({ projectId, model, ...rest }, deps) => {
    const started = await deps.api.post(
      `/projects/${seg(projectId)}/sfx/generate`,
      { ...rest, ...(model === undefined ? {} : { tool: model }) },
      WireSfxJobsStarted,
    )
    return jsonResult({
      jobIds: started.jobIds,
      next: { tool: 'wait', jobs: started.jobIds.map((id) => ({ kind: 'sfx', id })) },
    })
  },
})

const WireSuggestion = z.object({
  kind: z.string(),
  reason: z.string(),
  cue: z.object({ startSec: z.number(), durationSec: z.number(), prompt: z.string(), volume: z.number() }),
})

export const suggestSfxTool = defineTool({
  name: 'suggest_sfx',
  description:
    'Suggest sound-effect cues from the timeline effects and transitions (flash/zoom_punch → impact, whip_pan → ' +
    'whoosh, title_card → low boom, speed_lines → pass-by whoosh, shake → thud). Makes nothing. Edit the prompts/' +
    'volumes if needed and pass the cues to generate_sfx. Content sounds (engine, rain) are not suggested.',
  input: z.object({ projectId: Id }),
  handler: async ({ projectId }, { api }) => {
    const suggestions = await api.get(`/projects/${seg(projectId)}/sfx/suggestions`, z.array(WireSuggestion))
    return jsonResult({ suggestions, cues: suggestions.map((s) => s.cue) })
  },
})

const WireSfxClip = z.object({
  id: z.string(),
  track: z.string(),
  startSec: z.number(),
  durationSec: z.number(),
  content: z.object({ type: z.string(), mediaAssetId: z.string().optional(), volume: z.number().optional() }),
})
type WireSfxClip = z.infer<typeof WireSfxClip>

/** 効果音（SFX の段の音の素材）か。エフェクト・テロップはこのツールでは扱わない。 */
const isSfxClip = (clip: WireSfxClip): boolean => clip.track === 'SFX' && clip.content.type === 'media'

export const listSfxTool = defineTool({
  name: 'list_sfx',
  description: 'List the sound clips on the timeline SFX track (id, startSec, durationSec, volume), ordered by time. Use the ids with remove_sfx.',
  input: z.object({ projectId: Id }),
  handler: async ({ projectId }, { api }) => {
    const clips = await api.get(`/projects/${seg(projectId)}/clips`, z.array(WireSfxClip))
    const sounds = clips
      .filter(isSfxClip)
      .map((c) => ({
        id: c.id,
        startSec: round(c.startSec),
        durationSec: round(c.durationSec),
        volume: c.content.volume ?? 1,
        mediaAssetId: c.content.mediaAssetId ?? null,
      }))
      .sort((a, b) => a.startSec - b.startSec)
    return jsonResult({ sounds })
  },
})

const failureReason = (error: unknown): string => {
  if (error instanceof IxaApiError) return `${String(error.status)}: ${error.apiMessage}`
  throw error
}

export const removeSfxTool = defineTool({
  name: 'remove_sfx',
  description: 'Remove sound clips from the SFX track by id (from list_sfx or a finished sfx job). Other clips are refused with a reason.',
  input: z.object({ projectId: Id, clipIds: z.array(Id).min(1).max(200) }),
  handler: async ({ projectId, clipIds }, { api }) => {
    const clips = await api.get(`/projects/${seg(projectId)}/clips`, z.array(WireSfxClip))
    const byId = new Map(clips.map((clip) => [clip.id, clip]))
    const results = await mapLimited(clipIds, 4, async (id) => {
      const clip = byId.get(id)
      if (clip === undefined) return { ok: false as const, id, reason: 'この作品にそのクリップはありません' }
      if (!isSfxClip(clip)) return { ok: false as const, id, reason: '効果音ではないクリップは消しません（エフェクト・テロップなど）' }
      try {
        await api.request('DELETE', `/clips/${seg(id)}`, z.unknown())
        return { ok: true as const, id }
      } catch (error) {
        return { ok: false as const, id, reason: failureReason(error) }
      }
    })
    const failures = results.flatMap((r) => (r.ok ? [] : [{ id: r.id, reason: r.reason }]))
    return jsonResult({ removed: results.flatMap((r) => (r.ok ? [r.id] : [])), ...(failures.length > 0 ? { failures } : {}) })
  },
})
