import { join } from 'node:path'
import {
  createCharacterRepository,
  createImageCheckRepository,
  createImageJobRepository,
  createMediaAssetRepository,
  createProjectRepository,
  createScriptRepository,
  createShotReferenceRepository,
  createShotRepository,
  type DbClient,
} from '@ixa/db'
import {
  ImageCheckMaxRetries,
  type AiToolId,
  type GenerationContextSource,
  type MediaAssetId,
  type ProjectEventPublisher,
} from '@ixa/domain'
import { createClaudeCliImageChecker } from '@ixa/provider-llm'
import {
  codexCliImageModel,
  createCodexCliImageProvider,
  createKleinImageProvider,
  createStubImageProvider,
  KLEIN_IMAGE_MODELS,
  stubGeminiLikeImageModel,
} from '@ixa/provider-image'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import type { LocalGpuLease } from './generation/local-gpu-lease.js'
import type { ImageAdapter, ImageProcessorDeps } from './image/index.js'

/**
 * 絵コンテの画像を作る口（ADR-0029）。**どちらで作るかはジョブに記された口で決まる**（ADR-0032。
 * API が「使う AI」から決める）。ここは作れる口を並べるだけ。
 * Codex CLI は手元の CLI を呼び、契約の利用枠を使う（作るだけでは何も起動しない）。
 */
/** 手元の画像生成サーバ（ADR-0047）。`.env` の `LOCAL_IMAGE_GENERATOR` に書いたときだけ作る（API の一覧と同じ条件）。 */
export type KleinSettings = { readonly enabled: boolean; readonly baseUrl: string; readonly token: string | null }

/** klein-api の口は 1 つで、モデル（9B・4B・Z Image Turbo。ADR-0065）ごとに並べる。 */
const kleinAdapters = (stubOutputDir: string, klein: KleinSettings): readonly ImageAdapter[] => {
  if (!klein.enabled) return []
  const provider = createKleinImageProvider({ baseUrl: klein.baseUrl, token: klein.token, outputDir: join(stubOutputDir, 'klein') })
  return KLEIN_IMAGE_MODELS.map((model) => ({ provider, model }))
}

const imageAdapters = (workDir: string, stubOutputDir: string, klein: KleinSettings): readonly ImageAdapter[] => [
  { provider: createStubImageProvider({ outputDir: join(stubOutputDir, 'image') }), model: stubGeminiLikeImageModel },
  { provider: createCodexCliImageProvider({ workingDirRoot: join(workDir, 'codex') }), model: codexCliImageModel },
  ...kleinAdapters(stubOutputDir, klein),
]

/** image キューへ積む口（BullMQ の `Queue.add` の部分）。 */
export type ImageQueueAdd = {
  readonly add: (
    name: string,
    data: { readonly imageJobId: string; readonly step?: 'check' },
    options?: {
      readonly delay?: number
      readonly jobId?: string
      readonly removeOnComplete?: boolean
      readonly removeOnFail?: boolean
    },
  ) => Promise<unknown>
}

/**
 * 描く手順とチェックの手順を積む口（ADR-0055）。描く手順は API と同じ名前（`draw`）で積む。
 * **チェックの手順は `check-<ジョブ>` の ID で 1 つにまとめる**（同じ絵を 2 度見て払い、やり直しを 2 つ積まない。
 * レビューの指摘 2026-10-19）。終わったら消すので、後でまた積める（描く手順の投げ直しなど）。
 */
export const imageQueuePorts = (queue: ImageQueueAdd): ImageProcessorDeps['queue'] => ({
  draw: async (imageJobId) => {
    await queue.add('draw', { imageJobId })
  },
  check: async (imageJobId) => {
    await queue.add('check', { imageJobId, step: 'check' }, { jobId: `check-${imageJobId}`, removeOnComplete: true, removeOnFail: true })
  },
})

export const createImageWiring = (input: {
  readonly db: DbClient
  readonly storage: ObjectStorage
  readonly context: GenerationContextSource
  readonly mediaQueue: { readonly enqueue: (mediaAssetId: MediaAssetId) => Promise<void> }
  readonly events: ProjectEventPublisher
  readonly logger: Logger
  readonly stubOutputDir: string
  readonly klein: KleinSettings
  /** 動画・高画質化と同じ整理券（ADR-0047）。 */
  readonly localGpuLease: LocalGpuLease
  /** 順番待ちの絵を積み直す先（image キュー）。 */
  readonly imageQueue: ImageQueueAdd
  /** いま選んでいる文章の AI（ADR-0032）。Claude のときだけ作った絵をチェックする（ADR-0055）。 */
  readonly textTool: () => Promise<AiToolId>
  /** 自動のやり直しの上限（ADR-0055）。 */
  readonly maxRetries: number
  /** チェックに使う Claude のモデル（`IMAGE_CHECK_MODEL`。既定は Sonnet のモデル ID）。**チェックにだけ効かせる**。 */
  readonly checkModel: string
}): ImageProcessorDeps => {
  const workDir = process.env.IMAGE_WORK_DIR ?? '/tmp/ixa-image-work'
  const scripts = createScriptRepository(input.db)
  return {
    imageJobs: createImageJobRepository(input.db),
    imageChecks: createImageCheckRepository(input.db),
    checker: createClaudeCliImageChecker({ model: input.checkModel }),
    textTool: input.textTool,
    // 設定の範囲は domain の規則で確かめ直す（設定側と食い違ったら起動時に落とす）。
    maxRetries: ImageCheckMaxRetries.parse(input.maxRetries),
    queue: imageQueuePorts(input.imageQueue),
    shots: createShotRepository(input.db),
    projects: createProjectRepository(input.db),
    // キャラクターシート（ADR-0035）の材料と、できたシートを足す先。
    characters: createCharacterRepository(input.db),
    // キーアート（ADR-0051）の材料。脚本のいまの版がコンセプト・あらすじ（ADR-0030）。
    concept: async (projectId) => {
      const script = await scripts.findByProject(projectId)
      if (script === null || script.currentVersionId === null) return ''
      return (await scripts.findVersionById(script.currentVersionId))?.content ?? ''
    },
    mediaAssets: createMediaAssetRepository(input.db),
    shotReferences: createShotReferenceRepository(input.db),
    storage: input.storage,
    context: input.context,
    adapters: imageAdapters(workDir, input.stubOutputDir, input.klein),
    localGpuLease: input.localGpuLease,
    scheduler: {
      reschedule: async (data, delayMs) => {
        // API と同じ名前で積む（`draw`）。
        await input.imageQueue.add('draw', data, { delay: delayMs })
      },
    },
    mediaQueue: input.mediaQueue,
    events: input.events,
    workDir,
    logger: input.logger,
  }
}
