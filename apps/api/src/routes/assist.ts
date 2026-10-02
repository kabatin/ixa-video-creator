import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  CharacterLookRepository,
  CharacterRepository,
  LocationRepository,
  ProjectRepository,
  ScriptRepository,
  ShotRepository,
} from '@ixa/db'
import {
  AssistField,
  CharacterId as CharacterIdSchema,
  CharacterLookId as CharacterLookIdSchema,
  LocationId as LocationIdSchema,
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  type ProjectId,
} from '@ixa/domain'
import { MAX_ASSIST_INSTRUCTION_LENGTH, type TextAssistant } from '@ixa/provider-llm'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import type { Logger } from '../logger.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { assistContext, type AssistMaterials } from './assist-context.js'

/**
 * 入力を AI が手伝う（ADR-0032 の 3 段目。制作者 2026-09-30「コンセプトとか世界観とかを入力するところで、
 * LLM で入力を補助してもらえるような機能」）。欄の「✦ AI」から呼ぶ。
 *
 * **案を 1 つ返すだけで、欄は書き換えない**（使うかは人が決める。ARCHITECTURE §11）。
 * どの AI で出すかは「使う AI」のテキスト（使うたびに読む）。材料は欄ごとに `assist-context.ts`。
 */

export type AssistRoutesDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly shots: Pick<ShotRepository, 'findByProject'>
  readonly scripts: Pick<ScriptRepository, 'findByProject' | 'findVersionById'>
  readonly characters: Pick<CharacterRepository, 'findById'>
  readonly looks: Pick<CharacterLookRepository, 'findById'>
  readonly locations: Pick<LocationRepository, 'findById'>
  readonly textAssistant: () => Promise<TextAssistant>
  readonly logger: Logger
}

const AssistBody = z
  .object({
    field: AssistField,
    current: z.string().max(4000),
    instruction: z.string().trim().max(MAX_ASSIST_INSTRUCTION_LENGTH).nullable(),
    /** Shot の欄（説明・雰囲気）のとき。 */
    shotId: ShotIdSchema.optional(),
    /** 人物の欄（識別アンカー）のとき。 */
    characterId: CharacterIdSchema.optional(),
    /** Look の欄（衣装）のとき。 */
    lookId: CharacterLookIdSchema.optional(),
    /** ロケーションの欄（説明）のとき。 */
    locationId: LocationIdSchema.optional(),
  })
  .openapi('AssistInput')

const AssistData = z.object({ text: z.string(), costUsd: z.number().nonnegative() }).openapi('AssistResult')

const assistRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/assist',
  tags: ['ai'],
  summary: '欄に入れる文の案を、いま選んでいるテキストの AI で 1 つ出す（欄は書き換えない）',
  request: {
    params: z.object({ projectId: ProjectIdSchema }),
    body: { content: { 'application/json': { schema: AssistBody } } },
  },
  responses: {
    200: { description: '案', content: { 'application/json': { schema: successResponse(AssistData) } } },
    404: errorContent('作品・Shot・人物・Look・ロケーションが無い'),
    422: errorContent('欄に要る対象が指定されていない'),
    502: errorContent('AI が案を出せなかった'),
  },
})

type Body = z.infer<typeof AssistBody>

/** 欄に要る対象。Shot の欄なら Shot、人物の欄なら人物…。 */
const TARGET_OF: Readonly<Record<AssistField, keyof Body | null>> = {
  concept: null,
  look: null,
  avoid: null,
  shot_description: 'shotId',
  shot_mood: 'shotId',
  identity_anchors: 'characterId',
  wardrobe: 'lookId',
  location_description: 'locationId',
}

const conceptOf = async (deps: AssistRoutesDeps, projectId: ProjectId): Promise<string | null> => {
  const script = await deps.scripts.findByProject(projectId)
  if (script === null || script.currentVersionId === null) return null
  return (await deps.scripts.findVersionById(script.currentVersionId))?.content ?? null
}

/** 材料を読む。指定した対象が無ければ null（404）。 */
const loadMaterials = async (
  deps: AssistRoutesDeps,
  projectId: ProjectId,
  body: Body,
): Promise<AssistMaterials | null> => {
  const project = await deps.projects.findById(projectId)
  if (project === null) return null
  const [concept, shots] = await Promise.all([conceptOf(deps, projectId), deps.shots.findByProject(projectId)])
  const shot = body.shotId === undefined ? null : (shots.find((candidate) => candidate.id === body.shotId) ?? null)
  const look = body.lookId === undefined ? null : await deps.looks.findById(body.lookId)
  const characterId = body.characterId ?? look?.characterId
  const character = characterId === undefined ? null : await deps.characters.findById(characterId)
  const location = body.locationId === undefined ? null : await deps.locations.findById(body.locationId)
  const missing =
    (body.shotId !== undefined && shot === null) ||
    (body.lookId !== undefined && look === null) ||
    (body.characterId !== undefined && character === null) ||
    (body.locationId !== undefined && location === null)
  return missing ? null : { project, concept, shots, shot, character, look, location }
}

export const assistRoutes = (deps: AssistRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(assistRoute, async (c) => {
    const { projectId } = c.req.valid('param')
    const body = c.req.valid('json')
    const target = TARGET_OF[body.field]
    if (target !== null && body[target] === undefined) {
      return c.json(fail(VALIDATION_ERROR_MESSAGE, { [target]: ['この欄の案には対象が要ります'] }), 422)
    }
    const materials = await loadMaterials(deps, projectId, body)
    if (materials === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

    const assistant = await deps.textAssistant()
    const outcome = await assistant.suggest({
      field: body.field,
      current: body.current,
      instruction: body.instruction === null || body.instruction === '' ? null : body.instruction,
      context: [...assistContext(body.field, materials)],
    })
    if (!outcome.ok) {
      // プロンプト本文は載せない（材料に作品の文が入る）。理由と口の名前だけ残す。
      deps.logger.warn(
        { field: body.field, assistant: assistant.name, code: outcome.error.code },
        'AI が入力の案を出せませんでした',
      )
      return c.json(fail(`AI が案を出せませんでした: ${outcome.error.message}`), 502)
    }
    return c.json(ok({ text: outcome.text, costUsd: outcome.costUsd }), 200)
  })
