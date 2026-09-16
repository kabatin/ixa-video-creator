import { z } from 'zod'
import { MediaAssetId, ProjectId, ShotId, TimelineClipId } from '../common/ids.js'
import { Resolution, Seconds } from '../common/time.js'
import { Transition } from '../shot/shot.js'

/** VIDEO1 は Shot の投影なので TimelineClip を持たない（ADR-0002）。 */
export const TimelineTrack = z.enum(['VFX', 'TEXT', 'VIDEO2', 'SFX'])
export type TimelineTrack = z.infer<typeof TimelineTrack>

export const TimelineClipContent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('media'),
    mediaAssetId: MediaAssetId,
    inSec: Seconds,
    outSec: Seconds,
    volume: z.number().min(0).max(2).default(1),
  }),
  z.object({
    type: z.literal('text'),
    templateKey: z.string().min(1),
    params: z.record(z.unknown()).default({}),
  }),
  z.object({
    type: z.literal('motion_graphics'),
    templateKey: z.string().min(1),
    params: z.record(z.unknown()).default({}),
  }),
])
export type TimelineClipContent = z.infer<typeof TimelineClipContent>

export const TimelineClip = z.object({
  id: TimelineClipId,
  projectId: ProjectId,
  track: TimelineTrack,
  startSec: Seconds,
  durationSec: Seconds,
  layer: z.number().int().nonnegative().default(0),
  content: TimelineClipContent,
  opacity: z.number().min(0).max(1).default(1),
  createdAt: z.date(),
})
export type TimelineClip = z.infer<typeof TimelineClip>

/**
 * プレビューとレンダリングの共通入力。
 * これが同一であることで「プレビューでは合っていたのに書き出すとズレる」を構造的に防ぐ。
 */
export const TimelineDocument = z.object({
  version: z.literal(1),
  fps: z.number().positive(),
  resolution: Resolution,
  durationSec: Seconds,
  video1: z.array(
    z.object({
      shotId: ShotId,
      startSec: Seconds,
      durationSec: Seconds,
      mediaUrl: z.string(),
      inSec: Seconds,
    }),
  ),
  transitions: z.array(Transition),
  clips: z.array(TimelineClip),
  audio: z.array(
    z.object({
      mediaUrl: z.string(),
      startSec: Seconds,
      /**
       * 音源の尺。ミュージックビデオでは**音楽がタイムライン全体の尺を決める**ため必須。
       * これが無いと、Shot が曲より短いときにタイムラインが途中で切れる。
       */
      durationSec: Seconds,
      volume: z.number().min(0).max(2),
    }),
  ),
})
export type TimelineDocument = z.infer<typeof TimelineDocument>
