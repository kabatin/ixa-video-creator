import { SfxJobId } from '@ixa/domain'
import { z } from 'zod'

/** sfx キューのジョブの中身。**ID だけ**（中身は行から読む）。 */
export const SfxJobData = z.object({ sfxJobId: SfxJobId })
export type SfxJobData = z.infer<typeof SfxJobData>
