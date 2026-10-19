import { MotionEventKind, SfxCueAlign, type ShotId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * Take の動きの分析（ADR-0054）の読み口。Shot の口は採用中の Take の結果を**タイムラインの秒**で返す。
 * 頼むのは「効果音を作る」窓（分析がまだなら、開いたときに頼む）。
 */

export const WireMotionState = z.enum(['none', 'queued', 'running', 'succeeded', 'failed'])
export type WireMotionState = z.infer<typeof WireMotionState>

const WireCue = z.object({
  startSec: z.number(),
  durationSec: z.number(),
  prompt: z.string(),
  volume: z.number(),
  /** 音の一番大きいところを時刻に合わせる印（瞬間・通り過ぎ）。 */
  align: SfxCueAlign.optional(),
})

export const WireShotMotion = z.object({
  shotId: z.string(),
  takeId: z.string().nullable(),
  state: WireMotionState,
  failureMessage: z.string().nullable(),
  visionUsed: z.boolean().nullable(),
  energy: z.object({ startSec: z.number(), hopSec: z.number(), values: z.array(z.number()) }).nullable(),
  onsets: z.array(z.object({ atSec: z.number(), strength: z.number() })),
  events: z.array(
    z.object({
      kind: MotionEventKind,
      startSec: z.number(),
      durationSec: z.number(),
      label: z.string(),
      sfxPrompt: z.string(),
      confidence: z.number(),
    }),
  ),
  suggestions: z.array(z.object({ kind: z.string(), reason: z.string(), cue: WireCue })),
})
export type WireShotMotion = z.infer<typeof WireShotMotion>

const WireQueued = z.object({ state: WireMotionState })

/** 分析が終わったか（成功・失敗）。待つのをやめる合図。 */
export const isMotionSettled = (state: WireMotionState): boolean => state === 'succeeded' || state === 'failed'

export type MotionApi = {
  getShotMotion: (shotId: ShotId) => Promise<WireShotMotion>
  /** 採用中の Take を分析に積む。分析済みなら worker は何もしない。 */
  analyzeShotMotion: (shotId: ShotId) => Promise<WireMotionState>
}

export const createMotionApi = (requester: Requester): MotionApi => ({
  getShotMotion: async (shotId) =>
    requester.get(`/shots/${encodeURIComponent(shotId)}/motion-analysis`, WireShotMotion),
  analyzeShotMotion: async (shotId) =>
    (await requester.post(`/shots/${encodeURIComponent(shotId)}/motion-analysis`, undefined, WireQueued)).state,
})
