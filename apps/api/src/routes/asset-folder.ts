import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProjectRepository } from '@ixa/db'
import { ProjectId as ProjectIdSchema } from '@ixa/domain'
import { assetFolder, syncAssetFolder, type AssetFolderDeps } from '../asset-folder/asset-folder.js'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { displayLocation, type FolderOpener } from '../render-folder/render-folder.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * 作った素材のフォルダを Finder で開く口（ADR-0041）。
 *
 * 開く前に、まだ入っていない素材をハードリンクで入れる（前に作ったものも入る）。
 * **置き場が `fs` のときだけ置く口。** `s3` には手元のファイルが無く、張るものが無い。
 * 開くのはこの API が動いている Mac の Finder（ADR-0036 と同じ）。
 */

export type AssetFolderRoutesDeps = AssetFolderDeps & {
  readonly projects: Pick<ProjectRepository, 'findById'>
  /** 画面に出す場所でホームを `~` にするため。 */
  readonly homeDir: string
  readonly opener: FolderOpener
}

const CANNOT_OPEN_MESSAGE = 'このコンピュータでは Finder を開けません（Mac で動かしているときだけ開けます）'
const JSON_ONLY_MESSAGE = '本文は JSON で送ってください'
const folderProblem = (location: string): string => `素材フォルダを作れませんでした（保存先: ${location}）`
const finderProblem = (location: string): string =>
  `Finder を開けませんでした。素材はフォルダに入っています（保存先: ${location}）`

/** ADR-0036 と同じ理由。項目がすべて省略可能な本文を JSON 以外で通すと、別のサイトから書き込みと Finder の起動を起こせる。 */
const isJsonBody = (contentType: string | undefined): boolean =>
  contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json'

const ProjectParams = z.object({ id: ProjectIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })
const FolderData = z
  .object({ location: z.string(), canOpen: z.boolean() })
  .openapi('AssetFolder')
const OpenBody = z.object({}).openapi('AssetFolderOpenInput')
const OpenedData = z
  .object({
    location: z.string(),
    /** いまフォルダへ入れた数。 */
    linked: z.number().int().nonnegative(),
    /** 入れられなかったものと理由（利用者にそのまま見せる文）。 */
    failed: z.array(z.object({ reason: z.string() })),
  })
  .openapi('AssetFolderOpened')

const folderRoute = createRoute({
  method: 'get',
  path: '/projects/{id}/asset-folder',
  tags: ['projects'],
  summary: '作った素材を置くフォルダの場所',
  request: { params: ProjectParams },
  responses: {
    200: { description: '保存先', content: { 'application/json': { schema: successResponse(FolderData) } } },
    404: errorContent('プロジェクトが存在しない'),
    500: errorContent('サーバ内部エラー'),
  },
})

const openRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/asset-folder/open',
  tags: ['projects'],
  summary: 'まだ入っていない素材をフォルダへ入れ、Finder で開く',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: OpenBody } } },
  },
  responses: {
    200: { description: '開いた', content: { 'application/json': { schema: successResponse(OpenedData) } } },
    404: errorContent('プロジェクトが存在しない'),
    409: errorContent('この環境では Finder を開けない'),
    415: errorContent('本文が JSON ではない'),
    500: errorContent('フォルダを作れない・Finder を開けない'),
  },
})

export const assetFolderRoutes = (deps: AssetFolderRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(folderRoute, async (c) => {
      const project = await deps.projects.findById(c.req.valid('param').id)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(
        ok({
          location: displayLocation(assetFolder(deps.rootDir, project), deps.homeDir),
          canOpen: deps.opener.canOpen,
        }),
        200,
      )
    })
    .openapi(openRoute, async (c) => {
      if (!isJsonBody(c.req.header('content-type'))) return c.json(fail(JSON_ONLY_MESSAGE), 415)
      const project = await deps.projects.findById(c.req.valid('param').id)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      if (!deps.opener.canOpen) return c.json(fail(CANNOT_OPEN_MESSAGE), 409)

      const location = displayLocation(assetFolder(deps.rootDir, project), deps.homeDir)
      const synced = await syncAssetFolder(deps, project).catch((error: unknown) => {
        deps.logger.error({ projectId: project.id, err: error }, '素材フォルダを用意できませんでした')
        return null
      })
      if (synced === null) return c.json(fail(folderProblem(location)), 500)

      try {
        await deps.opener.open({ folder: synced.folder })
      } catch (error) {
        deps.logger.error({ projectId: project.id, err: error }, 'Finder を開けませんでした')
        return c.json(fail(finderProblem(location)), 500)
      }
      return c.json(
        ok({
          location,
          linked: synced.linked,
          failed: synced.failed.map(({ reason }) => ({ reason })),
        }),
        200,
      )
    })
