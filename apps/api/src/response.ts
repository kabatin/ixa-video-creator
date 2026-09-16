import { z } from '@hono/zod-openapi'

/**
 * 統一レスポンス形式（docs/ARCHITECTURE.md §18）。
 *   { success, data?, error?, meta? }
 * 検証エラーはフィールド単位のメッセージを `fields` に載せる。
 */

/** フィールド名 → エラーメッセージの一覧。 */
export const FieldErrors = z.record(z.string(), z.array(z.string())).openapi('FieldErrors', {
  example: { name: ['String must contain at least 1 character(s)'] },
})
export type FieldErrors = z.infer<typeof FieldErrors>

/** 一覧レスポンスに付けるメタ情報。 */
export const ListMeta = z.object({ total: z.number().int().nonnegative() }).openapi('ListMeta')
export type ListMeta = z.infer<typeof ListMeta>

export const ErrorResponse = z
  .object({
    success: z.literal(false),
    error: z.string(),
    fields: FieldErrors.optional(),
  })
  .openapi('ErrorResponse')
export type ErrorResponse = z.infer<typeof ErrorResponse>

/** data を持つ成功レスポンスのスキーマを作る。 */
export const successResponse = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ success: z.literal(true), data })

/** data と meta を持つ一覧レスポンスのスキーマを作る。 */
export const listResponse = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ success: z.literal(true), data: z.array(item), meta: ListMeta })

export type SuccessResponse<T> = { success: true; data: T }
/** JSON 化するため data は可変配列で持つ（Hono の JSONValue が readonly を受け付けない）。 */
export type ListResponse<T> = { success: true; data: T[]; meta: ListMeta }

export const ok = <T>(data: T): SuccessResponse<T> => ({ success: true, data })

export const okList = <T>(data: readonly T[]): ListResponse<T> => ({
  success: true,
  data: [...data],
  meta: { total: data.length },
})

export const fail = (error: string, fields?: FieldErrors): ErrorResponse =>
  fields === undefined ? { success: false, error } : { success: false, error, fields }

/** OpenAPI の responses に使い回すエラー応答の定義。 */
export const errorContent = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorResponse } },
})
