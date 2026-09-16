/** テスト用のワイヤ表現。API が返す JSON と同じ形（日時は ISO 文字列）。 */

export const PROJECT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW'
export const SHOT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0'
export const TAKE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB1'
export const MEDIA_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB2'
export const JOB_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB3'

const SPEC_HASH = 'a'.repeat(64)

export const cameraJson = {
  size: 'medium',
  angleH: 'front',
  angle: 'eye',
  lensMm: 35,
  movement: 'push_in',
  movementIntensity: 'subtle',
} as const

export const shotJson = {
  id: SHOT_ID,
  projectId: PROJECT_ID,
  sequenceId: null,
  order: 1000,
  code: 'S01-010',
  startSec: 0,
  durationSec: 4,
  sourceInSec: 0,
  description: '夜のスタジアム',
  dialogue: null,
  camera: cameraJson,
  mood: 'tense',
  sourceType: { type: 'ai_video' },
  selectedTakeId: null,
  status: 'draft',
  lockedAt: null,
  createdAt: '2026-09-16T01:02:03.000Z',
  updatedAt: '2026-09-16T01:02:03.000Z',
}

export const takeJson = {
  id: TAKE_ID,
  shotId: SHOT_ID,
  index: 1,
  mediaAssetId: MEDIA_ID,
  spec: {
    specVersion: 1,
    shotId: SHOT_ID,
    sourceType: 'ai_video',
    prompt: 'night stadium, medium shot',
    negativePrompt: null,
    promptParts: {
      styleGuide: '',
      shotDescription: '夜のスタジアム',
      identityAnchors: [],
      styleTokens: [],
      colorPalette: [],
      wardrobeTokens: [],
      cameraFragment: 'medium, from front',
      moodFragment: 'tense',
    },
    durationSec: 5,
    aspectRatio: '16:9',
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    seed: null,
    references: [],
    camera: cameraJson,
  },
  specHash: SPEC_HASH,
  providerId: 'kling',
  modelId: 'kling-v2',
  providerParams: { kind: 'http', request: {} },
  seedUsed: 42,
  costUsd: 0.35,
  generationTimeSec: 18.5,
  parentTakeId: null,
  regenerationReason: null,
  reviewStatus: 'pending',
  humanVerdict: 'unreviewed',
  createdAt: '2026-09-16T01:05:00.000Z',
}

export const generateResultJson = {
  jobIds: [JOB_ID],
  specHash: SPEC_HASH,
  resolvedModel: 'kling-v2',
  duplicateOfTakeId: null,
}
