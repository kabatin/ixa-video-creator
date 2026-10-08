import { UpscaleJobId as UpscaleJobIdSchema } from '@ixa/domain'
import { z } from 'zod'

/**
 * upscale キューのジョブデータ。
 *
 * **ID だけを運ぶ。** 元の Take も出す大きさも `upscale_jobs` の行が正
 * （`generation` キューと同じ考え方。ペイロードと行の二重管理をしない）。
 * **知らないキーは黙って捨てない**（`.strict()`）。積み方の間違いはここで気付く。
 */
export const UpscaleJobData = z.object({ upscaleJobId: UpscaleJobIdSchema }).strict()
export type UpscaleJobData = z.infer<typeof UpscaleJobData>

export const parseUpscaleJobData = (data: unknown): UpscaleJobData => UpscaleJobData.parse(data)
