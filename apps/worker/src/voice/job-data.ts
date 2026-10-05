import { VoiceJobId } from '@ixa/domain'
import { z } from 'zod'

/** voice キューのジョブの中身。**ID だけ**（中身は行から読む。キューに原稿を載せない）。 */
export const VoiceJobData = z.object({ voiceJobId: VoiceJobId })
export type VoiceJobData = z.infer<typeof VoiceJobData>
