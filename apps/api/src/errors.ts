import { CharacterLookInvariantError, DbNotFoundError } from '@ixa/db'
import type { Hook, OpenAPIHono } from '@hono/zod-openapi'
import type { Context, Env } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'
import type { Logger } from './logger.js'
import { fail, type FieldErrors } from './response.js'

export const VALIDATION_ERROR_MESSAGE = '入力の検証に失敗しました'
export const NOT_FOUND_MESSAGE = 'リソースが見つかりません'
export const INTERNAL_ERROR_MESSAGE = 'サーバ内部でエラーが発生しました'

/** zod の issue をフィールド名でグループ化する。ルート直下のエラーは "(root)" にまとめる。 */
export const zodErrorToFields = (error: ZodError): FieldErrors =>
  error.issues.reduce<FieldErrors>((acc, issue) => {
    const field = issue.path.join('.') || '(root)'
    return { ...acc, [field]: [...(acc[field] ?? []), issue.message] }
  }, {})

/**
 * @hono/zod-openapi の検証失敗フック。
 * 既定の 400 ではなく 422 + フィールド単位のエラーを返す（docs/ARCHITECTURE.md §18）。
 */
export const validationHook: Hook<unknown, Env, string, unknown> = (result, c) => {
  if (result.success) return undefined
  return c.json(fail(VALIDATION_ERROR_MESSAGE, zodErrorToFields(result.error)), 422)
}

/**
 * ハンドラ内で投げられた例外を統一レスポンスへ変換する。
 * 500 の場合、スタックトレースや DB の詳細はログにのみ出し、レスポンスには含めない。
 */
export const handleError = (logger: Logger) => (error: Error, c: Context) => {
  if (error instanceof ZodError) {
    return c.json(fail(VALIDATION_ERROR_MESSAGE, zodErrorToFields(error)), 422)
  }
  if (error instanceof DbNotFoundError) {
    return c.json(fail(`${error.entity} が見つかりません`), 404)
  }
  /**
   * ドメインの不変条件違反は利用者の操作ミスなので 422 で返す。
   *
   * ルート側でも捕まえてフィールド名を添えているが、ここは**取りこぼしの受け皿**。
   * 捕まえ忘れた経路で 500 になると、利用者には原因が分からなくなる。
   */
  if (error instanceof CharacterLookInvariantError) {
    return c.json(fail(error.message), 422)
  }
  if (error instanceof HTTPException) {
    const status: ContentfulStatusCode = error.status
    return c.json(fail(error.message || NOT_FOUND_MESSAGE), status)
  }

  logger.error(
    { err: error, method: c.req.method, path: c.req.path },
    'ハンドラで未処理の例外が発生しました',
  )
  return c.json(fail(INTERNAL_ERROR_MESSAGE), 500)
}

/** ルートに一致しなかったリクエストへの応答。 */
export const handleNotFound = (c: Context) => c.json(fail(NOT_FOUND_MESSAGE), 404)

/** onError / notFound をアプリに登録する。 */
export const registerErrorHandlers = <E extends Env>(app: OpenAPIHono<E>, logger: Logger) => {
  app.onError(handleError(logger))
  app.notFound(handleNotFound)
  return app
}
