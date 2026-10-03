import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProjectRepository } from '@ixa/db'
import { ProjectId as ProjectIdSchema, RenderJobId as RenderJobIdSchema } from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import {
  displayLocation,
  projectFolder,
  syncRenderFolder,
  type RenderFolderDeps,
} from '../render-folder/render-folder.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * 書き出した動画のフォルダを Finder で開く口（ADR-0036。制作者 2026-10-03「書き出し画面で生成された動画が
 * あるフォルダを開く導線が欲しい」）。
 *
 * 開く前に、まだフォルダに入っていない動画を入れる（今までの書き出しも含む）。
 * **開くのはこの API が動いている Mac の Finder。** 別の機械のブラウザから押しても、その機械では開かない。
 */

export type RenderFolderRoutesDeps = RenderFolderDeps & {
  readonly projects: Pick<ProjectRepository, 'findById'>
}

const CANNOT_OPEN_MESSAGE = 'このコンピュータでは Finder を開けません（Mac で動かしているときだけ開けます）'
const FOREIGN_JOB_MESSAGE = 'このプロジェクトの書き出しではありません'
const NOT_DONE_MESSAGE = 'まだ終わっていない書き出しです。終わってから開いてください'
const JSON_ONLY_MESSAGE = '本文は JSON で送ってください'
const folderProblem = (location: string): string => `書き出しフォルダを作れませんでした（保存先: ${location}）`
const finderProblem = (location: string): string =>
  `Finder を開けませんでした。動画はフォルダに入っています（保存先: ${location}）`

/**
 * 本文が JSON か。項目がすべて省略可能なので、JSON 以外（`text/plain` など）を `{}` として通すと、
 * 別のサイトのページから下調べ（preflight）の要らない送信で、ファイルの書き込みと Finder の起動を起こせてしまう。
 */
const isJsonBody = (contentType: string | undefined): boolean =>
  contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json'

const ProjectParams = z.object({ id: ProjectIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })
const FolderData = z
  .object({
    /** 画面に出す保存先（ホームは `~`）。 */
    location: z.string(),
    /** この環境で Finder を開けるか。 */
    canOpen: z.boolean(),
  })
  .openapi('RenderFolder')
const OpenBody = z
  .object({
    /** 選んだ状態で開く書き出し。省略するとフォルダを開く。 */
    renderJobId: RenderJobIdSchema.optional(),
  })
  .openapi('RenderFolderOpenInput')
const OpenedData = z
  .object({
    location: z.string(),
    /** いまフォルダへ入れた本数。 */
    copied: z.number().int().nonnegative(),
    /** 入れられなかった書き出しと理由（利用者にそのまま見せる文）。 */
    failed: z.array(z.object({ reason: z.string() })),
  })
  .openapi('RenderFolderOpened')

const folderRoute = createRoute({
  method: 'get',
  path: '/projects/{id}/render-folder',
  tags: ['renders'],
  summary: '書き出した動画を置くフォルダの場所',
  request: { params: ProjectParams },
  responses: {
    200: { description: '保存先', content: { 'application/json': { schema: successResponse(FolderData) } } },
    404: errorContent('プロジェクトが存在しない'),
    500: errorContent('サーバ内部エラー'),
  },
})

const openRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/render-folder/open',
  tags: ['renders'],
  summary: 'まだ入っていない動画をフォルダへ入れ、Finder で開く',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: OpenBody } } },
  },
  responses: {
    200: { description: '開いた', content: { 'application/json': { schema: successResponse(OpenedData) } } },
    404: errorContent('プロジェクトが存在しない'),
    409: errorContent('この環境では Finder を開けない'),
    415: errorContent('本文が JSON ではない'),
    422: errorContent('ほかのプロジェクトの書き出し・まだ終わっていない書き出し'),
    500: errorContent('フォルダを作れない・Finder を開けない'),
  },
})

export const renderFolderRoutes = (deps: RenderFolderRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(folderRoute, async (c) => {
      const project = await deps.projects.findById(c.req.valid('param').id)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const location = displayLocation(projectFolder(deps.rootDir, project), deps.homeDir)
      return c.json(ok({ location, canOpen: deps.opener.canOpen }), 200)
    })
    .openapi(openRoute, async (c) => {
      if (!isJsonBody(c.req.header('content-type'))) return c.json(fail(JSON_ONLY_MESSAGE), 415)
      const project = await deps.projects.findById(c.req.valid('param').id)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      if (!deps.opener.canOpen) return c.json(fail(CANNOT_OPEN_MESSAGE), 409)
      const { renderJobId } = c.req.valid('json')
      if (renderJobId !== undefined) {
        const job = await deps.renderJobs.findById(renderJobId)
        const problem =
          job === null || job.projectId !== project.id
            ? FOREIGN_JOB_MESSAGE
            : job.status !== 'succeeded' || job.outputAssetId === null
              ? NOT_DONE_MESSAGE
              : null
        if (problem !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, { renderJobId: [problem] }), 422)
      }
      const location = displayLocation(projectFolder(deps.rootDir, project), deps.homeDir)
      const synced = await syncRenderFolder(deps, project).catch((error: unknown) => {
        deps.logger.error({ projectId: project.id, err: error }, '書き出しフォルダを用意できませんでした')
        return null
      })
      if (synced === null) return c.json(fail(folderProblem(location)), 500)
      // 選ぶはずの 1 本を入れられなかったら、フォルダを開く（何も開かないより、残りが見える方がいい）。
      const file = renderJobId === undefined ? undefined : synced.files.get(renderJobId)
      try {
        await deps.opener.open(file === undefined ? { folder: synced.folder } : { file })
      } catch (error) {
        deps.logger.error({ projectId: project.id, err: error }, 'Finder を開けませんでした')
        return c.json(fail(finderProblem(location)), 500)
      }
      return c.json(
        ok({
          location,
          copied: synced.copied,
          failed: synced.failed.map(({ reason }) => ({ reason })),
        }),
        200,
      )
    })
