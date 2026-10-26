import { ImageCheckIssue, ImageGenerationJobStatus, MasteringMode, RenderPreset, RenderScope } from '@ixa/domain'
import { z } from 'zod'

/**
 * API の応答のうち、この MCP が読む部分だけの形（規約 4: 応答も検証する）。
 * 形の正は apps/api/src/routes/*.ts と packages/domain。知らない項目は zod が落とすので、
 * API に項目が増えてもここは壊れない。読む項目が消えたときだけ検証で落ちる。
 */

const nullableString = z.string().nullable()

export const WireProject = z.object({
  id: z.string(),
  name: z.string(),
  fps: z.number(),
  resolution: z.object({ width: z.number(), height: z.number() }),
  aspectRatio: z.string(),
  durationSec: z.number().nullable(),
  styleGuide: z.string().optional(),
  avoid: z.string().optional(),
  status: z.string(),
  /** 仕上げの音量（ADR-0060）。null は自動。古い API は返さないので省略可。 */
  masteringMode: MasteringMode.nullable().optional(),
})
export type WireProject = z.infer<typeof WireProject>

export const WireScript = z.object({
  currentVersion: z.object({ content: z.string() }).nullable(),
})

export const WireAppendedScript = z.object({ version: z.object({ content: z.string() }).nullable() })

export const WireCamera = z.object({
  size: z.string(),
  angleH: nullableString,
  angle: nullableString,
  lensMm: z.number().nullable(),
  movement: nullableString,
  movementIntensity: nullableString,
})

/** Shot のセリフの 1 行（ADR-0059）。訳文は 2 段字幕の 2 段目（ADR-0061）。 */
export const WireDialogueLine = z.object({
  speakerId: z.string(),
  text: z.string(),
  offscreen: z.boolean().optional(),
  translation: z.string().nullable().optional(),
  /** 声の差し替えの指定（ADR-0062）。中身は domain の `DialogueDub`（MCP は読み返すだけ）。 */
  dub: z.record(z.unknown()).optional(),
})

export const WireShot = z.object({
  id: z.string(),
  order: z.number(),
  code: z.string(),
  startSec: z.number(),
  durationSec: z.number(),
  /** 速さと Take の使い始め（ADR-0050）。古い API は返さないので省略可。 */
  speed: z.number().optional(),
  sourceInSec: z.number().optional(),
  /** Take の音（ADR-0060）。古い API は返さないので省略可。 */
  takeAudioVolume: z.number().optional(),
  takeAudioMuted: z.boolean().nullable().optional(),
  description: z.string().optional(),
  mood: nullableString,
  camera: WireCamera,
  locationId: nullableString,
  selectedTakeId: nullableString,
  status: z.string(),
  /** セリフの行（ADR-0059）と警告。古い API は返さないので省略可。 */
  dialogue: z.array(WireDialogueLine).optional(),
  dialogueWarnings: z.array(z.object({ code: z.string(), message: z.string() })).optional(),
})
export type WireShot = z.infer<typeof WireShot>

export const WireMusicTrack = z.object({
  id: z.string(),
  mediaAssetId: z.string(),
  title: z.string(),
  isMaster: z.boolean().optional(),
  offsetSec: z.number().optional(),
})
export type WireMusicTrack = z.infer<typeof WireMusicTrack>

export const WireAnalysis = z.object({
  durationSec: z.number(),
  bpm: z.number(),
  bpmConfidence: z.number(),
  beats: z.array(z.number()),
  downbeats: z.array(z.number()),
  sections: z.array(
    z.object({ start: z.number(), end: z.number(), label: z.string(), energy: z.number() }),
  ),
  energyCurve: z.object({ hopSec: z.number(), values: z.array(z.number()) }),
  drops: z.array(z.number()),
})
export type WireAnalysis = z.infer<typeof WireAnalysis>

export const WireAnalysisFailure = z.object({ message: z.string(), failedAt: z.string() }).nullable()

export const WireCharacter = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  /** セリフの声（ADR-0059）。古い API は返さないので省略可。 */
  speechName: z.string().nullable().optional(),
  voiceDescription: z.string().nullable().optional(),
  /** 差し替えのセリフの声（ADR-0062）。古い API は返さないので省略可。 */
  dialogueVoiceProfileId: z.string().nullable().optional(),
})
export type WireCharacter = z.infer<typeof WireCharacter>

export const WireLook = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  isDefault: z.boolean().optional(),
})

export const WireShotCharacter = z.object({
  characterId: z.string(),
  lookId: z.string(),
  prominence: z.string(),
  order: z.number(),
})

export const WireLocation = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  referenceAssetIds: z.array(z.string()).optional(),
})
export type WireLocation = z.infer<typeof WireLocation>

export const WireTransition = z.object({
  id: z.string(),
  fromShotId: z.string(),
  toShotId: z.string(),
  type: z.string(),
  durationSec: z.number().optional(),
})
export type WireTransition = z.infer<typeof WireTransition>

export const WireShotPoster = z.object({
  shotId: z.string(),
  hasStartFrame: z.boolean(),
  drawing: z.boolean(),
})

export const JobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
export type JobStatus = z.infer<typeof JobStatus>

/**
 * 作った絵のチェック（ADR-0055）。`mark` は pass（問題なし）・review（要確認）・retry（やり直し）・unchecked（見ていない）。
 */
export const WireImageCheck = z.object({
  mark: z.enum(['pass', 'review', 'retry', 'unchecked']),
  score: z.number().nullable(),
  issues: z.array(ImageCheckIssue),
  note: nullableString,
})
export type WireImageCheck = z.infer<typeof WireImageCheck>

/** 絵のジョブの状態。`checking` は絵ができてチェックしている最中（ADR-0055）。 */
export const ImageJobStatus = ImageGenerationJobStatus

export const WireStartFrame = z.object({
  mediaAssetId: nullableString,
  job: z
    .object({ id: z.string(), status: ImageJobStatus, error: nullableString, attempt: z.number().int().default(1) })
    .nullable()
    .optional(),
})

export const WireImageHistoryEntry = z.object({
  jobId: z.string(),
  status: ImageJobStatus,
  attempt: z.number().int(),
  retryOfJobId: nullableString,
  mediaAssetId: nullableString,
  applied: z.boolean(),
  current: z.boolean(),
  check: WireImageCheck.nullable(),
  error: nullableString,
  queuedAt: z.string(),
})
export type WireImageHistoryEntry = z.infer<typeof WireImageHistoryEntry>

export const WireStartFrameHistory = z.object({ items: z.array(WireImageHistoryEntry), maxRetries: z.number().int() })

export const WireGenerationJob = z.object({
  id: z.string(),
  shotId: z.string(),
  status: JobStatus,
  resolvedModel: nullableString,
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
})

export const WireActiveGeneration = z.object({
  jobId: z.string(),
  shotId: z.string(),
  status: z.enum(['queued', 'running']),
  modelId: nullableString,
  estimatedLatencySec: z.number().nullable(),
  queuedAt: z.string(),
  providerStartedAt: nullableString,
})

export const WireTake = z.object({
  id: z.string(),
  shotId: z.string(),
  index: z.number(),
  mediaAssetId: z.string(),
  spec: z.object({ durationSec: z.number() }),
  modelId: z.string(),
  seedUsed: z.number().nullable(),
  costUsd: z.number(),
  parentTakeId: nullableString,
  regenerationReason: nullableString,
  reviewStatus: z.string(),
  humanVerdict: z.string(),
  createdAt: z.string(),
})
export type WireTake = z.infer<typeof WireTake>

export const WireRenderJob = z.object({
  id: z.string(),
  status: z.enum(['queued', 'rendering', 'encoding', 'succeeded', 'failed', 'cancelled']),
  progress: z.number().optional(),
  outputAssetId: nullableString,
  error: nullableString,
  preset: RenderPreset,
  scope: RenderScope,
  createdAt: z.string(),
})
export type WireRenderJob = z.infer<typeof WireRenderJob>

/** サムネイルの書き出し（ADR-0051）。仕様は読まない（送ったものと同じ）。 */
export const WireThumbnail = z.object({
  id: z.string(),
  status: z.enum(['queued', 'rendering', 'done', 'failed']),
  outputAssetId: nullableString,
  fileName: z.string(),
  error: nullableString,
})
export type WireThumbnail = z.infer<typeof WireThumbnail>

/** サムネイルの背景を AI に描かせるジョブ（ADR-0051）。 */
export const WireKeyArtJob = z.object({
  id: z.string(),
  status: ImageJobStatus,
  mediaAssetId: nullableString,
  error: nullableString,
  /** 作った絵のチェック（ADR-0055）。 */
  check: WireImageCheck.nullable().default(null),
})
export type WireKeyArtJob = z.infer<typeof WireKeyArtJob>

export const WireMediaAsset = z.object({
  id: z.string(),
  kind: z.string(),
  mimeType: z.string(),
})

export const WireSignedUrl = z.object({ url: z.string().min(1) })

export const WireSignedUpload = z.object({
  mediaAssetId: z.string(),
  storageKey: z.string(),
  uploadUrl: z.string().min(1),
})

export const WireModel = z.object({
  id: z.string(),
  label: z.string(),
  durations: z.union([
    z.object({ mode: z.literal('enum'), values: z.array(z.number()) }),
    z.object({ mode: z.literal('range'), min: z.number(), max: z.number(), step: z.number().optional() }),
  ]),
  costPerSecondUsd: z.number(),
  requiresStartFrame: z.boolean(),
  routable: z.boolean(),
  qualityTier: z.string().nullable().optional(),
  /** セリフのある Shot の声を作れるか（ADR-0059）。古い API は返さないので省略可（作れないと読む）。 */
  audioGeneration: z.boolean().optional(),
})

export const WireAiTools = z.object({
  tools: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.union([
        z.object({ state: z.literal('ready') }),
        z.object({ state: z.literal('missing'), reason: z.string() }),
      ]),
      problems: z.record(z.string(), z.string().nullable()),
    }),
  ),
})

export const WireAiSettings = z.object({
  settings: z.record(z.string(), z.string()),
  source: z.enum(['saved', 'default']),
})

/** 一括操作の 1 件ごとの結果。失敗は理由つき。 */
export const bulkResult = <T extends z.ZodRawShape>(okShape: T) =>
  z.union([
    z.object({ shotId: z.string(), ok: z.literal(true), ...okShape }),
    z.object({ shotId: z.string(), ok: z.literal(false), reason: z.string() }),
  ])

/**
 * タイムラインのうち、Take の音を鳴らす Shot（ADR-0060）。鳴らす Shot だけ `audio` を持つ。
 * 署名付き URL（`mediaUrl`）は読まない（規約 7。結果にも出さない）。
 */
export const WireTimelineTakeAudio = z.object({
  video1: z.array(z.object({ shotId: z.string(), audio: z.object({ volume: z.number() }).optional() })),
})
