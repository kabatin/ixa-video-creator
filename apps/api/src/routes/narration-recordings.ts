import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  MediaAssetId as MediaAssetIdSchema,
  NarrationTakeId as NarrationTakeIdSchema,
  ProjectId as ProjectIdSchema,
  Seconds,
  VoiceProfileId as VoiceProfileIdSchema,
} from '@ixa/domain'
import type { TranscribeToolId, Transcriber } from '@ixa/provider-core'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { budgetProblem } from '../narration/budget.js'
import type { NarrationDeps } from '../narration/deps.js'
import { startVoiceJob } from '../narration/voice-job-start.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * 録音を取り込む・字の時刻を取る（ADR-0038）。どちらも「使う AI」の文字起こしで、worker が作る。
 * 頼む前に、音の長さから費用を見積もって予算を確かめる。
 */

const TRANSCRIBE_TOOLS: readonly TranscribeToolId[] = ['stub', 'whisper_cpp', 'elevenlabs', 'gemini_api']

const ProjectParams = z.object({ projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }) })
const TakeParams = z.object({ id: NarrationTakeIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })
const RecordingBody = z
  .object({
    /** アップロード済みの音（素材）。 */
    mediaAssetId: MediaAssetIdSchema,
    /** 分けた行に付ける声。無ければ未定。 */
    voiceProfileId: VoiceProfileIdSchema.nullable().default(null),
    /** 録音を置く位置（タイムラインの秒）。 */
    placeAtSec: Seconds.default(0),
  })
  .openapi('ImportNarrationRecording')

const json = <T extends z.ZodTypeAny>(description: string, schema: T) => ({ description, content: { 'application/json': { schema } } })
const errors = {
  404: errorContent('対象が存在しない'),
  409: errorContent('文字起こしの AI の口が無い・音の長さをまだ測っていない'),
  422: errorContent('音のファイルでない・予算を超える'),
}
const accepted = json('頼んだ', successResponse(z.object({ jobId: z.string() })))

const recordingRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/narration/recordings', tags: ['narration'],
  summary: '録音を取り込む（ノイズ除去して文字起こしし、行と Take にする）',
  request: { params: ProjectParams, body: { required: true, content: { 'application/json': { schema: RecordingBody } } } },
  responses: { 202: accepted, ...errors },
})
const charTimingRoute = createRoute({
  method: 'post', path: '/narration-takes/{id}/char-timing', tags: ['narration'],
  summary: '声の Take の字の時刻を取る（話している字を強調する字幕に使う）',
  request: { params: TakeParams },
  responses: { 202: accepted, ...errors },
})

const TRANSCRIBER_MISSING =
  '選んでいる文字起こしの AI は、この環境ではまだ使えません。「使う AI…」で文字起こしの AI を選び直してください'

/** いま選んでいる文字起こしの AI と、その口。口が無ければ null。 */
const currentTranscriber = async (deps: NarrationDeps): Promise<{ readonly tool: TranscribeToolId; readonly transcriber: Transcriber } | null> => {
  const chosen = await deps.currentTranscribeTool()
  const tool = TRANSCRIBE_TOOLS.find((candidate) => candidate === chosen)
  const transcriber = tool === undefined ? null : deps.transcriber(tool)
  return tool === undefined || transcriber === null ? null : { tool, transcriber }
}

export const narrationRecordingRoutes = (deps: NarrationDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(recordingRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.findById(projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const { mediaAssetId, voiceProfileId, placeAtSec } = c.req.valid('json')
      const asset = await deps.mediaAssets.findById(mediaAssetId)
      if (asset === null || asset.kind !== 'audio' || asset.workspaceId !== project.workspaceId) {
        const message = '取り込めるのは、この作品の場所にある音のファイルだけです'
        return c.json(fail(message, { mediaAssetId: [message] }), 422)
      }
      if (voiceProfileId !== null && (await deps.voices.findById(voiceProfileId))?.projectId !== projectId) {
        return c.json(fail('この作品の声ではありません', { voiceProfileId: ['この作品の声ではありません'] }), 422)
      }
      const durationSec = asset.probe?.durationSec ?? null
      if (durationSec === null) return c.json(fail('音の長さをまだ測っています。少し待ってからやり直してください'), 409)
      const chosen = await currentTranscriber(deps)
      if (chosen === null) return c.json(fail(TRANSCRIBER_MISSING), 409)
      const problem = await budgetProblem(deps, project, 0, deps.transcribeCostEstimate({ tool: chosen.tool, durationSec }))
      if (problem !== null) return c.json(fail(problem.reason, { cost: [problem.limit] }), 422)
      const job = await startVoiceJob(deps, {
        kind: 'transcribe',
        projectId,
        inputMediaAssetId: mediaAssetId,
        voiceProfileId,
        placeAtSec,
        tool: chosen.tool,
        model: null,
      })
      return c.json(ok({ jobId: job.id }), 202)
    })
    .openapi(charTimingRoute, async (c) => {
      const take = await deps.takes.findById(c.req.valid('param').id)
      const line = take === null ? null : await deps.lines.findById(take.lineId)
      const project = line === null ? null : await deps.projects.findById(line.projectId)
      if (take === null || line === null || project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const chosen = await currentTranscriber(deps)
      if (chosen === null) return c.json(fail(TRANSCRIBER_MISSING), 409)
      const estimate = deps.transcribeCostEstimate({ tool: chosen.tool, durationSec: take.outSec - take.inSec })
      const problem = await budgetProblem(deps, project, 0, estimate)
      if (problem !== null) return c.json(fail(problem.reason, { cost: [problem.limit] }), 422)
      const job = await startVoiceJob(deps, {
        kind: 'char_timing',
        projectId: project.id,
        lineId: line.id,
        takeId: take.id,
        inputMediaAssetId: take.mediaAssetId,
        tool: chosen.tool,
        model: null,
      })
      return c.json(ok({ jobId: job.id }), 202)
    })
