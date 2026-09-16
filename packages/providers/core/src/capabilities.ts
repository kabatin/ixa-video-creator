import { z } from 'zod'
import { AspectRatio, ReferenceRole, Resolution } from '@ixa/domain'

/**
 * モデルが出せる尺。Veo は 4/6/8 秒、Kling は 5/10 秒しか出せない（ADR-0011）。
 * この宣言が尺の切り上げとハードフィルタの根拠になる。
 */
export const DurationSupport = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('enum'), values: z.array(z.number().positive()).min(1) }),
  z.object({
    mode: z.literal('range'),
    min: z.number().positive(),
    max: z.number().positive(),
    step: z.number().positive().optional(),
  }),
])
export type DurationSupport = z.infer<typeof DurationSupport>

export const CameraControl = z.enum(['none', 'preset', 'prompt'])
export type CameraControl = z.infer<typeof CameraControl>

/**
 * バリデーション（不可能な要求を投げる前に弾く）に使う宣言。
 * 実 API と乖離しうるため、各アダプタに契約テストを置いて検知すること。
 */
export const VideoModelCapabilities = z.object({
  durations: DurationSupport,
  aspectRatios: z.array(AspectRatio).min(1),
  resolutions: z.array(Resolution).min(1),
  fps: z.array(z.number().positive()).min(1),
  referenceImages: z.object({
    max: z.number().int().nonnegative(),
    roles: z.array(ReferenceRole),
  }),
  seed: z.boolean(),
  negativePrompt: z.boolean(),
  cameraControl: CameraControl,
  audioGeneration: z.boolean(),
})
export type VideoModelCapabilities = z.infer<typeof VideoModelCapabilities>

/**
 * Model Router のスコアリングに使う評価値（0..1）。
 * 客観的な指標ではなく、Architect が実測と評判から与える相対値。
 */
export const ModelQualities = z.object({
  characterConsistency: z.number().min(0).max(1),
  motion: z.number().min(0).max(1),
  physics: z.number().min(0).max(1),
  cameraControl: z.number().min(0).max(1),
  promptAdherence: z.number().min(0).max(1),
})
export type ModelQualities = z.infer<typeof ModelQualities>

export const ModelEconomics = z.object({
  costPerSecondUsd: z.number().nonnegative(),
  typicalLatencySec: z.number().nonnegative(),
})
export type ModelEconomics = z.infer<typeof ModelEconomics>
