import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProjectRepository, ScriptRepository } from '@ixa/db'
import {
  ProjectId as ProjectIdSchema,
  Script as ScriptSchema,
  ScriptId as ScriptIdSchema,
  ScriptVersion as ScriptVersionSchema,
  ScriptVersionId as ScriptVersionIdSchema,
  type ProjectId,
  type ScriptVersion,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'

/**
 * Script / ScriptVersion の経路（DOMAIN.md §8）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 *
 * **版は追記のみ。** 本文を書き換える経路は用意しない。直したければ新しい版を積む。
 */

export const ScriptResponse = ScriptSchema.openapi('Script')

export const ScriptVersionResponse = ScriptVersionSchema.omit({ createdAt: true })
  .extend({ createdAt: z.string().datetime() })
  .openapi('ScriptVersion')
export type ScriptVersionResponse = z.infer<typeof ScriptVersionResponse>

export const toScriptVersionResponse = (version: ScriptVersion): ScriptVersionResponse => ({
  ...version,
  createdAt: version.createdAt.toISOString(),
})

/**
 * 脚本の「今」を 1 回の GET で返す。
 * Script だけ返しても、呼び出し側が本文を得るのに必ずもう 1 往復することになるため。
 */
const ScriptWithCurrentVersion = z
  .object({ script: ScriptResponse, currentVersion: ScriptVersionResponse.nullable() })
  .openapi('ScriptWithCurrentVersion')

/** 追記の結果。currentVersionId が進むので Script も返す。 */
const AppendedScriptVersionResponse = z
  .object({ script: ScriptResponse, version: ScriptVersionResponse })
  .openapi('AppendedScriptVersion')

/** scriptId は経路が持つので本文には含めない。正が 2 つになるのを避ける。 */
const AppendVersionBody = ScriptVersionSchema.pick({ content: true, authoredBy: true }).openapi(
  'AppendScriptVersionInput',
)

const SetCurrentVersionBody = z
  .object({ versionId: ScriptVersionIdSchema })
  .openapi('SetCurrentScriptVersionInput')

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})
const ScriptParams = z.object({
  id: ScriptIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})

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

const getScriptRoute = createRoute({
  method: 'get', path: '/projects/{projectId}/script', tags: ['scripts'],
  summary: 'Project の Script と現在の版',
  request: { params: ProjectParams },
  responses: {
    200: jsonContent('Script と現在の版', successResponse(ScriptWithCurrentVersion)),
    ...commonErrors,
  },
})

const appendVersionRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/script/versions', tags: ['scripts'],
  summary: '新しい版を追記する（Script が無ければ同時に作る）',
  request: { params: ProjectParams, body: body(AppendVersionBody) },
  responses: {
    201: jsonContent('追記された版', successResponse(AppendedScriptVersionResponse)),
    ...commonErrors,
  },
})

const listVersionsRoute = createRoute({
  method: 'get', path: '/scripts/{id}/versions', tags: ['scripts'],
  summary: '版の一覧（version 降順）',
  request: { params: ScriptParams },
  responses: {
    200: jsonContent('版の一覧', listResponse(ScriptVersionResponse)),
    ...commonErrors,
  },
})

const setCurrentVersionRoute = createRoute({
  method: 'post', path: '/scripts/{id}/current-version', tags: ['scripts'],
  summary: '現在の版を切り替える',
  request: { params: ScriptParams, body: body(SetCurrentVersionBody) },
  responses: {
    200: jsonContent('切り替え後の Script', successResponse(ScriptResponse)),
    ...commonErrors,
  },
})

export type ScriptRoutesDeps = {
  scripts: ScriptRepository
  /** Project の実在確認だけに使う。存在しない Project に脚本を生やさないため。 */
  projects: ProjectRepository
}

const FOREIGN_VERSION_MESSAGE = 'この Script に属する版ではありません'

export const scriptRoutes = (deps: ScriptRoutesDeps) => {
  const projectMissing = async (projectId: ProjectId): Promise<boolean> =>
    (await deps.projects.findById(projectId)) === null

  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(getScriptRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if (await projectMissing(projectId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const script = await deps.scripts.findByProject(projectId)
      if (script === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const current =
        script.currentVersionId === null
          ? null
          : await deps.scripts.findVersionById(script.currentVersionId)
      return c.json(
        ok({
          script,
          currentVersion: current === null ? null : toScriptVersionResponse(current),
        }),
        200,
      )
    })
    .openapi(appendVersionRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if (await projectMissing(projectId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const script = await deps.scripts.ensureForProject(projectId)
      /**
       * 追記と currentVersionId の前進はリポジトリが 1 トランザクションで行う。
       * ここで try/catch を張らないのは意図的で、**畳んでよい既知の失敗が無い**ため。
       * DB 由来の例外まで 422 にすると、障害が入力ミスに見える。
       */
      const appended = await deps.scripts.appendVersion({
        ...c.req.valid('json'),
        scriptId: script.id,
      })
      return c.json(
        ok({
          script: appended.script,
          version: toScriptVersionResponse(appended.version),
        }),
        201,
      )
    })
    .openapi(listVersionsRoute, async (c) => {
      const { id } = c.req.valid('param')
      const script = await deps.scripts.findById(id)
      if (script === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const versions = await deps.scripts.listVersions(script.id)
      return c.json(okList(versions.map(toScriptVersionResponse)), 200)
    })
    .openapi(setCurrentVersionRoute, async (c) => {
      const { id } = c.req.valid('param')
      const script = await deps.scripts.findById(id)
      if (script === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const { versionId } = c.req.valid('json')
      const version = await deps.scripts.findVersionById(versionId)
      // 他 Script（= 他 Project）の版を現在の版にさせない。版は Script に属する。
      if (version === null || version.scriptId !== script.id) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { versionId: [FOREIGN_VERSION_MESSAGE] }), 422)
      }

      const updated = await deps.scripts.setCurrentVersion(script.id, version.id)
      return c.json(ok(updated), 200)
    })
}
