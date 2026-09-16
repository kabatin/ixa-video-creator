import { z } from 'zod'
import { MediaAssetId, ProjectId, RenderJobId, ShotId } from '../common/ids.js'
import { Seconds } from '../common/time.js'
import { TimelineDocument } from '../timeline/timeline.js'

export const RenderPreset = z.enum([
  'preview_720p', 'master_1080p', 'master_4k', 'social_vertical',
])
export type RenderPreset = z.infer<typeof RenderPreset>

export const RenderScope = z.discriminatedUnion('type', [
  z.object({ type: z.literal('full') }),
  z.object({ type: z.literal('range'), start: Seconds, end: Seconds }),
  z.object({ type: z.literal('shot'), shotId: ShotId }),
])
export type RenderScope = z.infer<typeof RenderScope>

export const RenderJob = z.object({
  id: RenderJobId,
  projectId: ProjectId,
  scope: RenderScope,
  preset: RenderPreset,
  /** 何をレンダリングしたかが常に分かるようスナップショットを持つ。 */
  timelineSnapshot: TimelineDocument,
  status: z.enum(['queued', 'rendering', 'encoding', 'succeeded', 'failed', 'cancelled']),
  progress: z.number().min(0).max(1).default(0),
  outputAssetId: MediaAssetId.nullable(),
  error: z.string().nullable(),
  createdAt: z.date(),
  finishedAt: z.date().nullable(),
})
export type RenderJob = z.infer<typeof RenderJob>

export type RenderResult = {
  readonly storageKey: string
  readonly durationSec: Seconds
  readonly bytes: number
}

/**
 * レンダラの Port。Remotion を packages/render の外へ漏らさないための境界（ADR-0010）。
 */
export interface TimelineRenderer {
  readonly id: 'remotion' | 'ffmpeg'
  readonly capabilities: {
    readonly motionGraphics: boolean
    readonly textAnimation: boolean
    readonly perClipEffects: boolean
  }
  render(
    doc: TimelineDocument,
    preset: RenderPreset,
    onProgress: (progress: number) => void,
  ): Promise<RenderResult>
}
