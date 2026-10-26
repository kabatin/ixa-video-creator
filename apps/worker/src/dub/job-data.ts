import { DubJobId } from '@ixa/domain'
import { z } from 'zod'

/**
 * dub キューのジョブデータ。**ID だけを運ぶ**（元の Take も Shot も `dub_jobs` の行が正）。
 * 知らないキーは黙って捨てない（`.strict()`）。
 */
export const DubJobData = z.object({ dubJobId: DubJobId }).strict()
export type DubJobData = z.infer<typeof DubJobData>
