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

// --- Character / Look（docs/ARCHITECTURE.md §8） ---

export const WORKSPACE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
export const CHARACTER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC0'
export const IDENTITY_IMAGE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC1'
export const LOOK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC2'
export const LOOK_IMAGE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC3'
export const CANONICAL_FRAME_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC4'

export const characterJson = {
  id: CHARACTER_ID,
  workspaceId: WORKSPACE_ID,
  name: 'takepi',
  displayName: 'タケピ',
  description: '主人公',
  identityAnchors: ['20代日本人男性', '細身'],
  styleTokens: ['硬質な光'],
  colorPalette: ['#1A1A1A'],
  createdAt: '2026-09-16T01:02:03.000Z',
}

export const identityImageJson = {
  id: IDENTITY_IMAGE_ID,
  characterId: CHARACTER_ID,
  mediaAssetId: MEDIA_ID,
  role: 'four_view',
  isPrimary: true,
  order: 0,
}

export const lookJson = {
  id: LOOK_ID,
  characterId: CHARACTER_ID,
  key: 'IXA_CUP_PAST',
  name: 'iXA CUP 2019',
  era: '2019',
  description: '',
  wardrobeTokens: ['黒髪短髪'],
  styleTokens: [],
  colorPalette: [],
  isDefault: true,
  canonicalFrameAssetId: null,
}

export const lookImageJson = {
  id: LOOK_IMAGE_ID,
  lookId: LOOK_ID,
  mediaAssetId: MEDIA_ID,
  role: 'wardrobe',
  isPrimary: true,
  order: 0,
}

/** sha256('hello') — アップロードの完了通知に載る checksum の検証に使う。 */
export const HELLO_SHA256 =
  '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

export const mediaAssetJson = {
  id: MEDIA_ID,
  workspaceId: WORKSPACE_ID,
  projectId: null,
  kind: 'image',
  storageKey: `media/${WORKSPACE_ID}/${MEDIA_ID}/source.png`,
  mimeType: 'image/png',
  bytes: 5,
  checksumSha256: HELLO_SHA256,
  probe: null,
  proxyKey: null,
  thumbnailKey: null,
  posterKeys: [],
  lastFrameAssetId: null,
  origin: { type: 'upload', uploadedBy: 'web-ui' },
  tags: [],
  createdAt: '2026-09-16T01:02:03.000Z',
}
