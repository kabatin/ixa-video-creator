import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DuckingSettings,
  TelopHighlightSettings,
  ProjectAudioSettings,
  ProjectId as ProjectIdSchema,
  ReadingDictionary,
  readingDictionaryProblem,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import type { NarrationDeps } from '../narration/deps.js'
import { syncTelops } from '../narration/telops.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { narrationLineRoutes } from './narration-lines.js'
import { narrationRecordingRoutes } from './narration-recordings.js'
import { narrationSpeakRoutes } from './narration-speak.js'
import { narrationVoiceRoutes } from './narration-voices.js'

/**
 * ナレーションと声（ADR-0038）の API をまとめて置く。声・原稿の行・作品の音の設定（読み辞書・ダッキング）。
 */

const ProjectParams = z.object({ projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }) })
const SettingsBody = z
  .object({
    readingDictionary: ReadingDictionary,
    ducking: DuckingSettings,
    /** 話している字を強調するか（無ければ強調しない）。 */
    telopHighlight: TelopHighlightSettings.default({ enabled: false, color: DEFAULT_HIGHLIGHT_COLOR }),
  })
  .superRefine((value, ctx) => {
    const problem = readingDictionaryProblem(value.readingDictionary)
    if (problem !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ['readingDictionary'] })
  })
  .openapi('ProjectAudioSettingsInput')
const SettingsResponse = ProjectAudioSettings.innerType().openapi('ProjectAudioSettings')

const json = <T extends z.ZodTypeAny>(description: string, schema: T) => ({ description, content: { 'application/json': { schema } } })
const errors = { 404: errorContent('対象が存在しない'), 422: errorContent('入力の検証に失敗した') }

const getSettingsRoute = createRoute({
  method: 'get', path: '/projects/{projectId}/audio-settings', tags: ['narration'],
  summary: '作品の音の設定（読み辞書・ナレーションの間に BGM を下げる設定）',
  request: { params: ProjectParams },
  responses: { 200: json('音の設定', successResponse(SettingsResponse)), ...errors },
})
const putSettingsRoute = createRoute({
  method: 'put', path: '/projects/{projectId}/audio-settings', tags: ['narration'],
  summary: '作品の音の設定を保存する',
  request: { params: ProjectParams, body: { required: true, content: { 'application/json': { schema: SettingsBody } } } },
  responses: { 200: json('保存した設定', successResponse(SettingsResponse)), ...errors },
})

const audioSettingsRoutes = (deps: NarrationDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(getSettingsRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const settings = await deps.audioSettings.get(projectId)
      return c.json(ok({ ...settings, readingDictionary: [...settings.readingDictionary] }), 200)
    })
    .openapi(putSettingsRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const saved = await deps.audioSettings.save({ projectId, ...c.req.valid('json') })
      // 読み辞書（字の時刻の按分）と強調の設定はテロップに効く。
      await syncTelops(deps, projectId)
      return c.json(ok({ ...saved, readingDictionary: [...saved.readingDictionary] }), 200)
    })

export const narrationRoutes = (deps: NarrationDeps) => {
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', narrationVoiceRoutes(deps))
  app.route('/', narrationLineRoutes(deps))
  app.route('/', narrationSpeakRoutes(deps))
  app.route('/', narrationRecordingRoutes(deps))
  app.route('/', audioSettingsRoutes(deps))
  return app
}
