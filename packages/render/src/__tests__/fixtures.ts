import {
  ProjectId,
  ShotId,
  TimelineClipId,
  TransitionId,
  type RenderableClip,
  type RenderableClipContent,
  type TimelineDocument,
  type TimelineTrack,
  type Transition,
  type TransitionType,
} from '@ixa/domain'

/** ULID は 26 文字。末尾 2 桁だけ変えて読みやすい ID を作る。 */
const ulid = (n: number): string => `01ARZ3NDEKTSV4RRFFQ69G5F${n.toString().padStart(2, '0')}`

export const shotId = (n: number): ShotId => ShotId.parse(ulid(n))
export const clipId = (n: number): TimelineClipId => TimelineClipId.parse(ulid(n))
export const transitionId = (n: number): TransitionId => TransitionId.parse(ulid(n))
export const PROJECT_ID = ProjectId.parse(ulid(99))

export const makeVideo1Shot = (
  n: number,
  startSec: number,
  durationSec: number,
  inSec = 0,
): TimelineDocument['video1'][number] => ({
  shotId: shotId(n),
  startSec,
  durationSec,
  mediaUrl: `https://media.test/S${n}.mp4`,
  inSec,
})

export const makeTransition = (
  n: number,
  from: ShotId,
  to: ShotId,
  type: TransitionType,
  durationSec: number,
): Transition => ({
  id: transitionId(n),
  projectId: PROJECT_ID,
  fromShotId: from,
  toShotId: to,
  type,
  durationSec,
})

export const makeClip = (
  n: number,
  track: TimelineTrack,
  startSec: number,
  durationSec: number,
  layer = 0,
  content: RenderableClipContent = { type: 'text', templateKey: 'lower_third', params: {} },
): RenderableClip => ({
  id: clipId(n),
  track,
  startSec,
  durationSec,
  layer,
  content,
  opacity: 1,
})

/** 解決済みのメディアクリップ。`kind` は解決時に確定しているので拡張子に依存しない。 */
export const mediaContent = (
  kind: 'image' | 'video' | 'audio',
  mediaUrl = 'https://media.test/clip',
): RenderableClipContent => ({
  type: 'media',
  mediaUrl,
  kind,
  inSec: 0,
  outSec: 1,
  volume: 1,
})

/** 参照先を解決できなかったクリップ。 */
export const unresolvedContent = (reason: string): RenderableClipContent => ({
  type: 'unresolved',
  reason,
})

export const makeDocument = (overrides: Partial<TimelineDocument> = {}): TimelineDocument => ({
  version: 1,
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  durationSec: 4,
  video1: [],
  transitions: [],
  clips: [],
  audio: [],
  ...overrides,
})
