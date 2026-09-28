import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProjectRepository, TextStyleRepository } from '@ixa/db'
import {
  CreateTextStylePresetInput,
  ProjectId as ProjectIdSchema,
  TextStyleId as TextStyleIdSchema,
  TextStylePreset,
  UpdateTextStylePresetPatch,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'

/**
 * 名前を付けて保存したテロップの見た目（ADR-0028）。プロジェクトごと。
 * 当てるのは `clip-text-style.ts`（値をテロップへ写す）。ここは保存・一覧・直す・消すだけ。
 */

export type TextStyleRoutesDeps = {
  readonly textStyles: TextStyleRepository
  readonly projects: Pick<ProjectRepository, 'findById'>
}

export const DUPLICATE_TEXT_STYLE_NAME_MESSAGE = '同じ名前のスタイルが、このプロジェクトに既にあります'

export const TextStylePresetResponse = TextStylePreset.omit({ createdAt: true, updatedAt: true })
  .extend({ createdAt: z.string().datetime(), updatedAt: z.string().datetime() })
  .openapi('TextStylePreset')
export type TextStylePresetResponse = z.infer<typeof TextStylePresetResponse>

const toResponse = (style: TextStylePreset): TextStylePresetResponse => ({
  ...style,
  createdAt: style.createdAt.toISOString(),
  updatedAt: style.updatedAt.toISOString(),
})

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})
const StyleParams = z.object({
  id: TextStyleIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})
const CreateBody = CreateTextStylePresetInput.openapi('CreateTextStylePresetInput')
const UpdateBody = UpdateTextStylePresetPatch.openapi('UpdateTextStylePresetPatch')

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})
const body = <T extends z.ZodTypeAny>(schema: T) => ({
  required: true as const,
  content: { 'application/json': { schema } },
})
const commonErrors = {
  404: errorContent('対象が存在しない'),
  422: errorContent('入力の検証に失敗した'),
  500: errorContent('サーバ内部エラー'),
}
const withConflict = { ...commonErrors, 409: errorContent('同じ名前のスタイルがある') }

const listRoute = createRoute({
  method: 'get', path: '/projects/{projectId}/text-styles', tags: ['text-styles'],
  summary: 'テロップのスタイルの一覧（作った順）',
  request: { params: ProjectParams },
  responses: { 200: jsonContent('スタイルの一覧', listResponse(TextStylePresetResponse)), ...commonErrors },
})

const createStyleRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/text-styles', tags: ['text-styles'],
  summary: 'テロップのスタイルを名前を付けて保存する',
  request: { params: ProjectParams, body: body(CreateBody) },
  responses: { 201: jsonContent('保存したスタイル', successResponse(TextStylePresetResponse)), ...withConflict },
})

const updateStyleRoute = createRoute({
  method: 'patch', path: '/text-styles/{id}', tags: ['text-styles'],
  summary: 'テロップのスタイルの名前・中身を直す（当てたテロップへの反映は別の操作）',
  request: { params: StyleParams, body: body(UpdateBody) },
  responses: { 200: jsonContent('直したスタイル', successResponse(TextStylePresetResponse)), ...withConflict },
})

const deleteStyleRoute = createRoute({
  method: 'delete', path: '/text-styles/{id}', tags: ['text-styles'],
  summary: 'テロップのスタイルを消す（当てたテロップの見た目は残る）',
  request: { params: StyleParams },
  responses: { 204: { description: '消した（本文なし）' }, ...commonErrors },
})

const duplicate = () => fail(DUPLICATE_TEXT_STYLE_NAME_MESSAGE, { name: [DUPLICATE_TEXT_STYLE_NAME_MESSAGE] })

export const textStyleRoutes = (deps: TextStyleRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const found = await deps.textStyles.findByProject(projectId)
      return c.json(okList(found.map(toResponse)), 200)
    })
    .openapi(createStyleRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const input = c.req.valid('json')
      if ((await deps.textStyles.findByName(projectId, input.name)) !== null) return c.json(duplicate(), 409)
      const created = await deps.textStyles.create(projectId, input)
      return c.json(ok(toResponse(created)), 201)
    })
    .openapi(updateStyleRoute, async (c) => {
      const { id } = c.req.valid('param')
      const current = await deps.textStyles.findById(id)
      if (current === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const patch = c.req.valid('json')
      if (patch.name !== undefined) {
        const sameName = await deps.textStyles.findByName(current.projectId, patch.name)
        if (sameName !== null && sameName.id !== id) return c.json(duplicate(), 409)
      }
      const updated = await deps.textStyles.update(id, patch)
      return c.json(ok(toResponse(updated)), 200)
    })
    .openapi(deleteStyleRoute, async (c) => {
      await deps.textStyles.softDelete(c.req.valid('param').id)
      return c.body(null, 204)
    })
