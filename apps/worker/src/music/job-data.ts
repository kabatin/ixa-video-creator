import { MusicJobId } from '@ixa/domain'
import { z } from 'zod'

/** music キューのジョブの中身。**ID だけ**（中身は行から読む。キューに歌詞を載せない）。 */
export const MusicJobData = z.object({ musicJobId: MusicJobId })
export type MusicJobData = z.infer<typeof MusicJobData>
