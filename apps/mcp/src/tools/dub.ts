import { MAX_DESIGNED_VOICE_DESCRIPTION, VOICE_NAME_MAX } from '@ixa/domain'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { assertShotsInProject } from '../lib/project-scope.js'
import type { CheckResult } from '../lib/wait-loop.js'
import { defineTool, describeError, Id, jsonResult, mapLimited, round, ToolInputError } from '../tool-def.js'

/**
 * 声の差し替え（ADR-0062 段 5b）。採用中の音付き Take の H3 の声を、キャラクターの「セリフの声」で読み直した
 * **新しい Take** を作る（元の Take は残る。出来たら自動で採用される）。説明から声を作る（Voice Design）もここ。
 */

const WireDubLine = z.object({
  lineIndex: z.number(),
  mode: z.string(),
  added: z.boolean(),
  agreement: z.number().nullable(),
  tempoMin: z.number(),
  tempoMax: z.number(),
  placedStartSec: z.number(),
  placedEndSec: z.number(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
})

const WireSuggestedSpan = z.object({ lineIndex: z.number(), startSec: z.number(), endSec: z.number() })

export const WireDubJob = z.object({
  id: z.string(),
  projectId: z.string(),
  shotId: z.string(),
  sourceTakeId: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  takeId: z.string().nullable(),
  costUsd: z.number(),
  error: z
    .object({ code: z.string(), message: z.string(), retryable: z.boolean(), suggestedSpans: z.array(WireSuggestedSpan).optional() })
    .nullable(),
  record: z.object({ lines: z.array(WireDubLine) }).passthrough().nullable(),
})
export type WireDubJob = z.infer<typeof WireDubJob>

/** 行ごとの結果（一致率・伸縮の幅・警告）。エージェントが読み方を直すかを決める材料。 */
const linesOf = (job: WireDubJob) =>
  (job.record?.lines ?? []).map((line) => ({
    lineIndex: line.lineIndex,
    mode: line.mode,
    ...(line.added ? { added: true } : {}),
    agreement: line.agreement === null ? null : round(line.agreement, 2),
    tempoMin: round(line.tempoMin, 2),
    tempoMax: round(line.tempoMax, 2),
    placedSec: [round(line.placedStartSec), round(line.placedEndSec)],
    warnings: line.warnings.map((w) => w.message),
  }))

/** `wait` の `kind: "dub"`。 */
export const dubJobCheck = async (api: ApiClient, jobId: string): Promise<CheckResult> => {
  const job = await api.get(`/dub-jobs/${seg(jobId)}`, WireDubJob)
  if (job.status === 'queued' || job.status === 'running') return { state: 'pending', detail: { status: job.status, shotId: job.shotId } }
  if (job.status === 'succeeded') {
    return { state: 'succeeded', detail: { shotId: job.shotId, takeId: job.takeId, sourceTakeId: job.sourceTakeId, lines: linesOf(job) } }
  }
  if (job.status === 'cancelled') return { state: 'cancelled', detail: { shotId: job.shotId } }
  return {
    state: 'failed',
    detail: {
      shotId: job.shotId,
      error: job.error?.message ?? null,
      ...(job.error?.suggestedSpans === undefined || job.error.suggestedSpans.length === 0
        ? {}
        : { suggestedSpans: job.error.suggestedSpans, hint: SUGGESTED_SPANS_HINT }),
    },
  }
}

export const SUGGESTED_SPANS_HINT =
  'Put each suggested span into that dialogue line as dub.startSec/dub.endSec with edit_shots (adjust if needed), then dub_takes again.'

export const DubTakesInput = z.object({
  projectId: Id,
  shotIds: z
    .array(Id)
    .min(1)
    .max(50)
    // 同じ Shot を 2 度積むと、2 本目は断られるか二重に払う。渡し間違いとして止める。
    .refine((ids) => new Set(ids).size === ids.length, { message: 'shotIds must not repeat a shot' }),
})

export const dubTakesTool = defineTool({
  name: 'dub_takes',
  risk: 'costly',
  description:
    'Replace the H3 voices of each shot\'s SELECTED take (it must have sound) with each speaker\'s dialogue voice ' +
    '(edit_character character.dialogueVoiceProfileId; design_voice makes one), lip-synced per line. Costs Gemini TTS ' +
    '(cached readings are reused for free). The result is a NEW take that is selected automatically; the source take is ' +
    'kept (adopt it again to undo). Per-line options are edit_shots dialogue[].dub. Returns jobIds: wait with {kind:"dub", id}; ' +
    'the result lists per line agreement (lip match 0–1), tempoMin/tempoMax (stretch; > 1.4 sounds rushed) and warnings.',
  input: DubTakesInput,
  handler: async ({ projectId, shotIds }, { api }) => {
    await assertShotsInProject(api, projectId, shotIds)
    // 1 本の断り（声を作っている最中・音が無いなど）で残りを止めない。理由つきで返す。
    const results = await mapLimited(shotIds, 4, (shotId) =>
      api.post(`/shots/${seg(shotId)}/dub`, {}, WireDubJob).then(
        (job) => ({ shotId, ok: true as const, jobId: job.id, sourceTakeId: job.sourceTakeId }),
        (error: unknown) => ({ shotId, ok: false as const, reason: describeError(error) }),
      ),
    )
    const jobs = results.flatMap((r) => (r.ok ? [{ kind: 'dub' as const, id: r.jobId }] : []))
    return jsonResult({ queued: jobs.length, results, ...(jobs.length === 0 ? {} : { next: { tool: 'wait', jobs } }) })
  },
})

const WireOwner = z.object({ id: z.string(), projectId: z.string() })

const WireDesigned = z.object({
  voice: z.object({
    id: z.string(),
    name: z.string(),
    voiceName: z.string(),
    designedVoice: z.object({ keyLabel: z.string() }).passthrough().nullable().optional(),
  }),
  sampleMediaAssetId: z.string().nullable(),
})

export const DesignVoiceInput = z.object({
  projectId: Id,
  characterId: Id,
  description: z
    .string()
    .trim()
    .min(1)
    .max(MAX_DESIGNED_VOICE_DESCRIPTION)
    .describe('What the voice sounds like (Japanese or English), e.g. "落ち着いた低い声の老紳士。ゆっくり話す".'),
  gender: z.enum(['female', 'male']),
  displayName: z.string().trim().min(1).max(VOICE_NAME_MAX).describe('Voice name shown in ixa (Japanese), e.g. "ネコの声". Unique in the project.'),
})

export const designVoiceTool = defineTool({
  name: 'design_voice',
  risk: 'costly',
  description:
    'Create a new Gemini voice from a description (Voice Design; paid, call only when the user asks for a new voice). ' +
    'It is stored as a voice of the character with a sample (sampleMediaAssetId). It only works with the Gemini key it ' +
    'was made with. To use it for dubbing, set it with edit_character {action:"update", character:{dialogueVoiceProfileId: voiceId}}.',
  input: DesignVoiceInput,
  handler: async ({ projectId, characterId, description, gender, displayName }, { api }) => {
    const character = await api.get(`/characters/${seg(characterId)}`, WireOwner)
    if (character.projectId !== projectId) throw new ToolInputError('そのキャラクターはこの作品のものではありません')
    const made = await api.post(`/characters/${seg(characterId)}/voices/design`, { description, gender, displayName }, WireDesigned)
    return jsonResult({
      voiceId: made.voice.id,
      name: made.voice.name,
      keyLabel: made.voice.designedVoice?.keyLabel ?? null,
      sampleMediaAssetId: made.sampleMediaAssetId,
      note: '声の一覧に保存しました。差し替えに使うなら edit_character の character.dialogueVoiceProfileId にこの voiceId を入れる',
    })
  },
})
