import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  CreateVoiceProfileInput,
  ProjectId as ProjectIdSchema,
  UpdateVoiceProfilePatch,
  VoiceProfile,
  VoiceProfileId as VoiceProfileIdSchema,
  VoiceToolId,
  type CharacterId,
  type ProjectId,
  type TextStyleId,
} from '@ixa/domain'
import { VoiceProviderError } from '@ixa/provider-core'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import type { NarrationDeps } from '../narration/deps.js'
import { syncTelops } from '../narration/telops.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'

/**
 * 声（ADR-0038）。作品ごとにナレーター・キャラクターの声を持つ。声の種類は、その AI の一覧（`/voices/options`）から選ぶ。
 */

export const DUPLICATE_VOICE_NAME_MESSAGE = '同じ名前の声が、この作品に既にあります'

export const VoiceProfileResponse = VoiceProfile.omit({ createdAt: true, updatedAt: true })
  .extend({ createdAt: z.string().datetime(), updatedAt: z.string().datetime() })
  .openapi('VoiceProfile')
export type VoiceProfileResponse = z.infer<typeof VoiceProfileResponse>

export const toVoiceResponse = (voice: VoiceProfile): VoiceProfileResponse => ({
  ...voice,
  createdAt: voice.createdAt.toISOString(),
  updatedAt: voice.updatedAt.toISOString(),
})

const ProjectParams = z.object({ projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }) })
const VoiceParams = z.object({ id: VoiceProfileIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })
const OptionsQuery = z.object({
  tool: VoiceToolId.openapi({ param: { name: 'tool', in: 'query' } }),
  language: z.string().min(2).max(10).default('ja').openapi({ param: { name: 'language', in: 'query' } }),
})
const VoiceOptions = z
  .object({
    models: z.array(z.object({ id: z.string(), label: z.string() })),
    voices: z.array(z.object({ id: z.string(), label: z.string(), note: z.string().nullable() })),
  })
  .openapi('VoiceOptions')

const json = <T extends z.ZodTypeAny>(description: string, schema: T) => ({ description, content: { 'application/json': { schema } } })
const body = <T extends z.ZodTypeAny>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } })
const errors = { 404: errorContent('対象が存在しない'), 422: errorContent('入力の検証に失敗した') }

const listRoute = createRoute({
  method: 'get', path: '/projects/{projectId}/voices', tags: ['narration'],
  summary: '声の一覧（作った順）',
  request: { params: ProjectParams },
  responses: { 200: json('声の一覧', listResponse(VoiceProfileResponse)), ...errors },
})
const createVoiceRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/voices', tags: ['narration'],
  summary: '声を作る',
  request: { params: ProjectParams, body: body(CreateVoiceProfileInput.omit({ projectId: true }).openapi('CreateVoiceProfileInput')) },
  responses: { 201: json('作った声', successResponse(VoiceProfileResponse)), 409: errorContent('同じ名前の声がある'), ...errors },
})
const updateVoiceRoute = createRoute({
  method: 'patch', path: '/voices/{id}', tags: ['narration'],
  summary: '声を直す',
  request: { params: VoiceParams, body: body(UpdateVoiceProfilePatch.openapi('UpdateVoiceProfilePatch')) },
  responses: { 200: json('直した声', successResponse(VoiceProfileResponse)), 409: errorContent('同じ名前の声がある'), ...errors },
})
const deleteVoiceRoute = createRoute({
  method: 'delete', path: '/voices/{id}', tags: ['narration'],
  summary: '声を消す（その声の行は「声が未定」に戻る。作った声の Take は残る）',
  request: { params: VoiceParams },
  responses: { 204: { description: '消した（本文なし）' }, ...errors },
})
const optionsRoute = createRoute({
  method: 'get', path: '/voices/options', tags: ['narration'],
  summary: 'その AI で選べるモデルと声の種類',
  request: { query: OptionsQuery },
  responses: {
    200: json('選べるモデルと声', successResponse(VoiceOptions)),
    409: errorContent('その AI の口が無い'),
    502: errorContent('AI から一覧を取れなかった'),
    ...errors,
  },
})

const duplicate = () => fail(DUPLICATE_VOICE_NAME_MESSAGE, { name: [DUPLICATE_VOICE_NAME_MESSAGE] })

const CHARACTER_MISMATCH = 'この作品のキャラクターではありません'
const TEXT_STYLE_MISMATCH = 'この作品のテロップの見た目ではありません'

/** 別の作品のキャラクター・テロップの見た目を指していれば、その欄と理由（指したまま保存すると、別の作品に引きずられる）。 */
const foreignReference = async (
  deps: NarrationDeps,
  projectId: ProjectId,
  input: { readonly characterId?: CharacterId | null; readonly textStyleId?: TextStyleId | null },
): Promise<Record<string, string[]> | null> => {
  if (input.characterId !== undefined && input.characterId !== null) {
    const character = await deps.characters.findById(input.characterId)
    if (character?.projectId !== projectId) return { characterId: [CHARACTER_MISMATCH] }
  }
  if (input.textStyleId !== undefined && input.textStyleId !== null) {
    const styles = await deps.textStyles.findByProject(projectId)
    if (!styles.some((style) => style.id === input.textStyleId)) return { textStyleId: [TEXT_STYLE_MISMATCH] }
  }
  return null
}

const mismatch = (fields: Record<string, string[]>) => fail(Object.values(fields)[0]?.[0] ?? '', fields)

export const narrationVoiceRoutes = (deps: NarrationDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(okList((await deps.voices.findByProject(projectId)).map(toVoiceResponse)), 200)
    })
    .openapi(createVoiceRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const input = c.req.valid('json')
      if ((await deps.voices.findByName(projectId, input.name)) !== null) return c.json(duplicate(), 409)
      const foreign = await foreignReference(deps, projectId, input)
      if (foreign !== null) return c.json(mismatch(foreign), 422)
      return c.json(ok(toVoiceResponse(await deps.voices.create({ ...input, projectId }))), 201)
    })
    .openapi(updateVoiceRoute, async (c) => {
      const { id } = c.req.valid('param')
      const current = await deps.voices.findById(id)
      if (current === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const patch = c.req.valid('json')
      if (patch.name !== undefined) {
        const sameName = await deps.voices.findByName(current.projectId, patch.name)
        if (sameName !== null && sameName.id !== id) return c.json(duplicate(), 409)
      }
      const foreign = await foreignReference(deps, current.projectId, patch)
      if (foreign !== null) return c.json(mismatch(foreign), 422)
      const updated = await deps.voices.update(id, patch)
      // 声の見た目を変えたら、その声の行のテロップに当て直す（名前や声のイメージだけなら、テロップは変わらない）。
      if (patch.textStyleId !== undefined && patch.textStyleId !== current.textStyleId) {
        const lines = await deps.lines.findByProject(current.projectId)
        await syncTelops(deps, current.projectId, lines.filter((line) => line.voiceProfileId === id).map((line) => line.id))
      }
      return c.json(ok(toVoiceResponse(updated)), 200)
    })
    .openapi(deleteVoiceRoute, async (c) => {
      const { id } = c.req.valid('param')
      const current = await deps.voices.findById(id)
      if (current === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      // その声で話す行は「声が未定」に戻す（消した声を指したままにしない）。
      const lines = (await deps.lines.findByProject(current.projectId)).filter((l) => l.voiceProfileId === id)
      for (const line of lines) {
        await deps.lines.update(line.id, { voiceProfileId: null })
      }
      await deps.voices.softDelete(id)
      // 声の見た目で出していたテロップは、既定の見た目に当て直す。
      await syncTelops(deps, current.projectId, lines.map((line) => line.id))
      return c.body(null, 204)
    })
    .openapi(optionsRoute, async (c) => {
      const { tool, language } = c.req.valid('query')
      const adapter = deps.voiceAdapter(tool)
      if (adapter === null) return c.json(fail('この AI の声の一覧はまだ出せません。「使う AI…」で使えるか確かめてください'), 409)
      try {
        const voices = await adapter.listVoices(language)
        return c.json(ok({ models: [...adapter.models], voices: [...voices] }), 200)
      } catch (error) {
        if (error instanceof VoiceProviderError) return c.json(fail(error.message), 502)
        throw error
      }
    })
