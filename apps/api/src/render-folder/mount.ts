import { OpenAPIHono } from '@hono/zod-openapi'
import type { AppDeps } from '../app.js'
import { validationHook } from '../errors.js'
import { assetFolderRoutes } from '../routes/asset-folder.js'
import { renderFolderRoutes } from '../routes/render-folder.js'

/**
 * 書き出しフォルダ（ADR-0036）と作った素材のフォルダ（ADR-0041）の口。**フォルダの場所があるときだけ置く**（無ければ null）。
 * app.ts が大きくなりすぎたので、組み立てをここへ移した（中身は前と同じ）。
 */
export const renderFolderRouter = (
  deps: Pick<
    AppDeps,
    'renderFolder' | 'projects' | 'renderJobs' | 'thumbnails' | 'mediaAssets' | 'storage' | 'logger' | 'files' | 'shots' | 'takes' | 'shotReferences'
  >,
): OpenAPIHono | null => {
  const place = deps.renderFolder
  if (place === undefined) return null
  const router = new OpenAPIHono({ defaultHook: validationHook })
  router.route(
    '/',
    renderFolderRoutes({
      ...place,
      projects: deps.projects,
      renderJobs: deps.renderJobs,
      ...(deps.thumbnails === undefined ? {} : { thumbnails: deps.thumbnails.repository }),
      mediaAssets: deps.mediaAssets,
      storage: deps.storage,
      logger: deps.logger,
    }),
  )
  /**
   * 作った素材のフォルダ（ADR-0041）。**手元のファイルがあるときだけ置く。**
   * ハードリンクを張るので、置き場が `s3`（`deps.files` が無い）なら張るものが無い。
   */
  if (deps.files !== undefined) {
    router.route(
      '/',
      assetFolderRoutes({
        rootDir: place.rootDir,
        homeDir: place.homeDir,
        opener: place.opener,
        projects: deps.projects,
        shots: deps.shots,
        takes: deps.takes,
        shotReferences: deps.shotReferences,
        mediaAssets: deps.mediaAssets,
        storage: deps.files.storage,
        logger: deps.logger,
      }),
    )
  }
  return router
}
