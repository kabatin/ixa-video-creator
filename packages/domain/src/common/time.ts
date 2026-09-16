import { z } from 'zod'

/**
 * 時間は常に「秒（float）」で表す。
 * ミリ秒・フレーム数を Domain / DB に持ち込まないこと（CLAUDE.md 規約 3）。
 */
export const Seconds = z.number().finite().nonnegative()
export type Seconds = z.infer<typeof Seconds>

/** end は排他（end は含まない）。 */
export const TimeRange = z
  .object({ start: Seconds, end: Seconds })
  .refine((r) => r.end > r.start, { message: 'end must be greater than start' })
export type TimeRange = z.infer<typeof TimeRange>

export const Resolution = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})
export type Resolution = z.infer<typeof Resolution>

export const AspectRatio = z.enum(['16:9', '9:16', '1:1', '4:5', '21:9'])
export type AspectRatio = z.infer<typeof AspectRatio>

export const Fps = z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)])
export type Fps = z.infer<typeof Fps>

export const Cost = z.object({
  amountUsd: z.number().nonnegative(),
  unit: z.string(),
  estimated: z.boolean(),
})
export type Cost = z.infer<typeof Cost>

/** 秒をフレームへ変換する唯一の関数。round を使う（floor は 1 フレームずれる）。 */
export const secondsToFrames = (seconds: Seconds, fps: number): number =>
  Math.round(seconds * fps)

export const framesToSeconds = (frames: number, fps: number): Seconds => frames / fps

export const rangesOverlap = (a: TimeRange, b: TimeRange): boolean =>
  a.start < b.end && b.start < a.end
