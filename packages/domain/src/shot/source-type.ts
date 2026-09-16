import { z } from 'zod'
import { MediaAssetId, TakeId } from '../common/ids.js'
import { Seconds } from '../common/time.js'

export const KenBurns = z.object({
  fromScale: z.number().positive(),
  toScale: z.number().positive(),
  fromX: z.number(), fromY: z.number(),
  toX: z.number(), toY: z.number(),
})
export type KenBurns = z.infer<typeof KenBurns>

/**
 * Shot がどう作られるか。生成パイプラインの分岐はここだけで決まる。
 * ai_image_to_video を独立させたのは、キャラクター一貫性の主戦場が画像生成側にあるため。
 */
export const ShotSourceType = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ai_video') }),
  z.object({ type: z.literal('ai_image_to_video'), keyframeTakeId: TakeId.nullable() }),
  z.object({
    type: z.literal('still_image'),
    mediaAssetId: MediaAssetId.nullable(),
    kenBurns: KenBurns.nullable(),
  }),
  z.object({
    type: z.literal('existing_footage'),
    mediaAssetId: MediaAssetId.nullable(),
    inSec: Seconds,
    outSec: Seconds,
  }),
  z.object({
    type: z.literal('motion_graphics'),
    templateKey: z.string().min(1),
    params: z.record(z.unknown()).default({}),
  }),
  z.object({ type: z.literal('generated_graphic'), mediaAssetId: MediaAssetId.nullable() }),
])
export type ShotSourceType = z.infer<typeof ShotSourceType>

export const SourceTypeName = z.enum([
  'ai_video', 'ai_image_to_video', 'still_image',
  'existing_footage', 'motion_graphics', 'generated_graphic',
])
export type SourceTypeName = z.infer<typeof SourceTypeName>

/** この sourceType は外部 Provider による生成を伴うか。 */
export const requiresGeneration = (s: ShotSourceType): boolean =>
  s.type === 'ai_video' || s.type === 'ai_image_to_video' || s.type === 'generated_graphic'
