import { isAbsolute } from 'node:path'
import { VoiceJobStatus } from '@ixa/domain'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { uploadLocalFile } from '../lib/media-io.js'
import { waitForDuration } from '../lib/media-probe.js'
import type { CheckResult } from '../lib/wait-loop.js'
import { defineTool, Id, jsonResult, round, ToolInputError } from '../tool-def.js'
import { findVoice, listVoices } from './narration.js'

/**
 * ナレーションを声にする・録音を取り込む（ADR-0038）。どちらも worker の voice キューのジョブ。
 *
 *   POST /projects/{id}/narration/speak       { lineIds? } → 202 { jobIds, reusedTakeIds, skipped }
 *   POST /projects/{id}/narration/recordings  { mediaAssetId, voiceProfileId, placeAtSec, denoise } → 202 { jobId }
 *   GET  /voice-jobs/{id} → { status, lineId, error }
 *
 * 声の AI（Gemini など）は課金。頼む前の予算の確かめは API がする。
 */

const WireSpoken = z.object({
  jobIds: z.array(z.string()),
  reusedTakeIds: z.array(z.string()),
  skipped: z.object({ noVoice: z.number(), active: z.number(), upToDate: z.number() }),
})

const WireVoiceJob = z.object({
  status: VoiceJobStatus,
  lineId: z.string().nullable(),
  error: z.string().nullable(),
})

/** 声のジョブが終わったか（`wait` の kind:"voice" に使う）。 */
export const voiceJobCheck = async (api: ApiClient, jobId: string): Promise<CheckResult> => {
  const job = await api.get(`/voice-jobs/${seg(jobId)}`, WireVoiceJob)
  if (job.status === 'queued' || job.status === 'running') return { state: 'pending', detail: { status: job.status } }
  if (job.status === 'succeeded') return { state: 'succeeded', detail: { lineId: job.lineId } }
  return { state: job.status, detail: { lineId: job.lineId, error: job.error } }
}

const waitNext = (jobIds: readonly string[]) => ({ tool: 'wait', jobs: jobIds.map((id) => ({ kind: 'voice', id })) })

export const SpeakNarrationInput = z.object({
  projectId: Id,
  action: z.enum(['speak', 'import_recording']).default('speak'),
  lineIds: z.array(Id).max(1000).optional().describe('speak: lines to voice (default all). Lines already voiced with the same text/voice are reused, not paid again.'),
  filePath: z.string().min(1).refine(isAbsolute, 'absolute path required').optional().describe('import_recording: a local audio file (mp3/wav/m4a/aac/flac/ogg).'),
  mediaAssetId: Id.optional().describe('import_recording: an already uploaded recording (instead of filePath).'),
  voice: z.string().min(1).optional().describe('import_recording: voice name/id to assign to the transcribed lines.'),
  placeAtSec: z.number().min(0).default(0).describe('import_recording: timeline seconds where the recording starts.'),
  denoise: z.boolean().default(true).describe('import_recording: false for already-processed or synthetic audio (denoise muffles it).'),
})

export const speakNarrationTool = defineTool({
  name: 'speak_narration',
  risk: 'costly',
  description:
    'speak: voice the narration lines with each line\'s voice AI (Gemini etc. — paid, cheap). import_recording: ' +
    'upload a local recording, transcribe it into lines and takes. Both return jobIds; wait with {kind:"voice", id}. ' +
    'Then set_narration arrange places the lines by their real length.',
  input: SpeakNarrationInput,
  handler: async (args, { api, workspaceId, clock }) => {
    const { projectId } = args
    if (args.action === 'speak') {
      const spoken = await api.post(
        `/projects/${seg(projectId)}/narration/speak`,
        args.lineIds === undefined ? {} : { lineIds: args.lineIds },
        WireSpoken,
      )
      return jsonResult({
        jobIds: spoken.jobIds,
        reused: spoken.reusedTakeIds.length,
        skipped: spoken.skipped,
        ...(spoken.skipped.noVoice > 0 ? { hint: 'Some lines have no usable voice: set one with set_narration edit_lines.' } : {}),
        ...(spoken.jobIds.length > 0 ? { next: waitNext(spoken.jobIds) } : {}),
      })
    }
    if ((args.filePath === undefined) === (args.mediaAssetId === undefined)) {
      throw new ToolInputError('import_recording には filePath か mediaAssetId のどちらか 1 つが要ります')
    }
    const voiceProfileId = args.voice === undefined ? null : findVoice(await listVoices(api, projectId), args.voice, 'voice').id
    const mediaAssetId =
      args.mediaAssetId ?? (await uploadLocalFile(api, args.filePath ?? '', { workspaceId, projectId, kind: 'audio' }))
    // 取り込みは音の長さを測ってから（API は測る前だと 409 を返す）。
    const durationSec = await waitForDuration(api, clock, mediaAssetId)
    if (durationSec === null) {
      throw new ToolInputError(
        `録音は上げました（mediaAssetId ${mediaAssetId}）が、音の長さをまだ測れていません。少し待ってから mediaAssetId で取り込み直してください`,
      )
    }
    const started = await api.post(
      `/projects/${seg(projectId)}/narration/recordings`,
      { mediaAssetId, voiceProfileId, placeAtSec: round(args.placeAtSec), denoise: args.denoise },
      z.object({ jobId: z.string() }),
    )
    return jsonResult({ jobIds: [started.jobId], mediaAssetId, durationSec: round(durationSec), next: waitNext([started.jobId]) })
  },
})
