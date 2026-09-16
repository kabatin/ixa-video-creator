import { Project } from '@ixa/domain'
import { z } from 'zod'

/**
 * ワイヤ表現。JSON には Date が無く日時は文字列で届くため、
 * ドメインの `Project` スキーマの日時列だけを coerce に差し替える。
 * それ以外の制約（ULID / fps / 解像度 / ステータス）はドメイン定義をそのまま使う。
 */
export const WireProject = Project.extend({
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type WireProject = z.infer<typeof WireProject>

export const WireProjectList = z.array(WireProject)

/** docs/ARCHITECTURE.md §18: レスポンスは `{ success, data?, error?, meta? }` に統一されている。 */
export const ApiEnvelope = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
})
export type ApiEnvelope = z.infer<typeof ApiEnvelope>
