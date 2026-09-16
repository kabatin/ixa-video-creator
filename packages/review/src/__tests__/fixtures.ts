import {
  MediaAssetId,
  ModelId,
  MusicAnalysisId,
  MusicTrackId,
  ProjectId,
  ProviderId,
  ShotId,
  TakeId,
  type MusicAnalysis,
  type Seconds,
  type Shot,
  type ShotGenerationSpec,
  type Take,
} from '@ixa/domain'
import type { FrameSample, ReviewMeasurements, VideoMeasurement } from '../port.js'

/** ULID は 26 文字。末尾 2 桁だけを変えて読みやすい ID を作る。 */
const ulid = (n: number): string => `01ARZ3NDEKTSV4RRFFQ69G5F${n.toString().padStart(2, '0')}`

export const PROJECT_ID = ProjectId.parse(ulid(90))
export const SHOT_ID = ShotId.parse(ulid(1))
export const TAKE_ID = TakeId.parse(ulid(2))
export const MEDIA_ASSET_ID = MediaAssetId.parse(ulid(3))

const EPOCH = new Date('2026-09-16T00:00:00.000Z')

const CAMERA = {
  size: 'medium',
  angleH: null,
  angle: null,
  lensMm: null,
  movement: null,
  movementIntensity: null,
} as const

/** 120 BPM のビートグリッド。拍間隔 0.5 秒、小節 2.0 秒、0〜32 秒を覆う。 */
export const BEATS: readonly Seconds[] = Array.from({ length: 65 }, (_, i) => i * 0.5)

export const makeSpec = (overrides: Partial<ShotGenerationSpec> = {}): ShotGenerationSpec => ({
  specVersion: 1,
  shotId: SHOT_ID,
  sourceType: 'ai_video',
  prompt: 'テスト用プロンプト',
  negativePrompt: null,
  promptParts: {
    styleGuide: '',
    shotDescription: '',
    identityAnchors: [],
    styleTokens: [],
    colorPalette: [],
    wardrobeTokens: [],
    cameraFragment: '',
    moodFragment: null,
  },
  durationSec: 4,
  aspectRatio: '16:9',
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  seed: null,
  references: [],
  camera: CAMERA,
  ...overrides,
})

export const makeTake = (overrides: Partial<Take> = {}): Take => ({
  id: TAKE_ID,
  shotId: SHOT_ID,
  index: 1,
  mediaAssetId: MEDIA_ASSET_ID,
  spec: makeSpec(),
  specHash: 'a'.repeat(64),
  providerId: ProviderId.parse('stub'),
  modelId: ModelId.parse('stub-video-v1'),
  providerParams: { kind: 'http', request: {} },
  seedUsed: null,
  costUsd: 0,
  generationTimeSec: 1,
  parentTakeId: null,
  regenerationReason: null,
  reviewStatus: 'pending',
  humanVerdict: 'unreviewed',
  createdAt: EPOCH,
  ...overrides,
})

export const makeShot = (overrides: Partial<Shot> = {}): Shot => ({
  id: SHOT_ID,
  projectId: PROJECT_ID,
  sequenceId: null,
  order: 1000,
  code: 'S01',
  startSec: 0,
  durationSec: 4,
  sourceInSec: 0,
  description: '',
  dialogue: null,
  camera: CAMERA,
  mood: null,
  locationId: null,
  sourceType: { type: 'ai_video' },
  selectedTakeId: null,
  status: 'review',
  lockedAt: null,
  createdAt: EPOCH,
  updatedAt: EPOCH,
  ...overrides,
})

export const makeVideo = (overrides: Partial<VideoMeasurement> = {}): VideoMeasurement => ({
  durationSec: 4,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudioStream: true,
  ...overrides,
})

export const makeFrame = (
  atSec: Seconds,
  meanLuma: number,
  colorRatios: Record<string, number> = {},
): FrameSample => ({ atSec, meanLuma, colorRatios })

/** 既定の抽出フレーム。輝度がばらついているので静止画化には当たらない。 */
export const DEFAULT_FRAMES: readonly FrameSample[] = [
  makeFrame(0, 0.42),
  makeFrame(1, 0.48),
  makeFrame(2, 0.51),
  makeFrame(3, 0.45),
]

export const makeMusicAnalysis = (overrides: Partial<MusicAnalysis> = {}): MusicAnalysis => ({
  id: MusicAnalysisId.parse(ulid(4)),
  musicTrackId: MusicTrackId.parse(ulid(5)),
  analyzerVersion: 'librosa-v1',
  durationSec: 32,
  bpm: 120,
  bpmConfidence: 0.9,
  beats: [...BEATS],
  downbeats: BEATS.filter((_, i) => i % 4 === 0),
  sections: [{ start: 0, end: 32, label: 'verse', energy: 0.5 }],
  energyCurve: { hopSec: 0.023, values: [] },
  onsets: [],
  drops: [],
  waveformPeaksKey: 'peaks/test.json',
  createdAt: EPOCH,
  ...overrides,
})

export const makeMeasurements = (
  overrides: Partial<ReviewMeasurements> = {},
): ReviewMeasurements => ({
  take: makeTake(),
  shot: makeShot(),
  video: makeVideo(),
  frames: DEFAULT_FRAMES,
  musicAnalysis: null,
  expected: { width: 1920, height: 1080, fps: 30 },
  brandColors: [],
  ...overrides,
})

/** 入力が変更されていないことを確認するためのスナップショット。 */
export const snapshot = (value: unknown): string => JSON.stringify(value)
