import {
  ProjectId,
  ShotId,
  TimelineClipId,
  TransitionId,
  type Seconds,
  type Shot,
  type TimelineClip,
  type TimelineTrack,
  type Transition,
} from '@ixa/domain'
import type { TimelineSource } from '../build.js'

/** ULID は 26 文字。末尾 2 桁だけを変えて読みやすい ID を作る。 */
const ulid = (n: number): string => `01ARZ3NDEKTSV4RRFFQ69G5F${n.toString().padStart(2, '0')}`

export const shotId = (n: number): ShotId => ShotId.parse(ulid(n))
export const clipId = (n: number): TimelineClipId => TimelineClipId.parse(ulid(n))
export const transitionId = (n: number): TransitionId => TransitionId.parse(ulid(n))
export const PROJECT_ID = ProjectId.parse(ulid(99))

const EPOCH = new Date('2026-09-16T00:00:00.000Z')

export const PROJECT = {
  fps: 30 as const,
  resolution: { width: 1920, height: 1080 },
}

/** 120 BPM のビートグリッド。拍間隔 0.5 秒、小節 2.0 秒。 */
export const BEATS: readonly Seconds[] = Array.from({ length: 65 }, (_, i) => i * 0.5)

export const makeShot = (
  n: number,
  startSec: Seconds,
  durationSec: Seconds,
  overrides: Partial<Shot> = {},
): Shot => ({
  id: shotId(n),
  projectId: PROJECT_ID,
  sequenceId: null,
  order: n * 1000,
  code: `S${n}`,
  startSec,
  durationSec,
  sourceInSec: 0,
  description: '',
  dialogue: null,
  camera: {
    size: 'medium',
    angleH: null,
    angle: null,
    lensMm: null,
    movement: null,
    movementIntensity: null,
  },
  mood: null,
  sourceType: { type: 'ai_video' },
  selectedTakeId: null,
  status: 'approved',
  lockedAt: null,
  createdAt: EPOCH,
  updatedAt: EPOCH,
  ...overrides,
})

export const makeClip = (
  n: number,
  track: TimelineTrack,
  startSec: Seconds,
  durationSec: Seconds,
  layer = 0,
): TimelineClip => ({
  id: clipId(n),
  projectId: PROJECT_ID,
  track,
  startSec,
  durationSec,
  layer,
  content: { type: 'text', templateKey: 'lower_third', params: {} },
  opacity: 1,
  createdAt: EPOCH,
})

export const makeTransition = (
  n: number,
  fromShotId: ShotId,
  toShotId: ShotId,
  durationSec: Seconds,
): Transition => ({
  id: transitionId(n),
  projectId: PROJECT_ID,
  fromShotId,
  toShotId,
  type: 'dissolve',
  durationSec,
})

/** 既定ではすべての Shot に採用 Take があるものとして URL を返す。 */
export const makeSource = (overrides: Partial<TimelineSource> = {}): TimelineSource => ({
  project: PROJECT,
  shots: [],
  transitions: [],
  clips: [],
  musicTracks: [],
  resolveShotMedia: (shot) => `https://media.test/${shot.code}.mp4`,
  ...overrides,
})

/** 入力配列と各要素が変更されていないことを確認するためのスナップショット。 */
export const snapshot = <T>(values: readonly T[]): string => JSON.stringify(values)
