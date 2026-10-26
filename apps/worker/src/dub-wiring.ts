import type { AppConfig } from '@ixa/config'
import {
  createCharacterRepository,
  createDubJobRepository,
  createMediaAssetRepository,
  createProjectClipLock,
  createProjectRepository,
  createShotRepository,
  createTakeRepository,
  createTtsClipRepository,
  createVoiceProfileRepository,
  type DbClient,
} from '@ixa/db'
import type { MediaAssetId, ProjectEventPublisher } from '@ixa/domain'
import { createVoiceAdapters } from '@ixa/provider-voice'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import type { DubProcessorDeps } from './dub/index.js'
import { audioAdapterOptions } from './voice-wiring.js'

/**
 * 声の差し替え（ADR-0062 段 5b）の配線。読み上げの口はナレーションと同じ表（鍵があって AUDIO_API_PROVIDERS に
 * 書いたときだけ Gemini の口ができる）。鍵の名札（`GEMINI_KEY_LABEL`）は秘密ではない設定値。
 */
export const createDubWiring = (input: {
  readonly config: AppConfig
  readonly db: DbClient
  readonly storage: ObjectStorage
  readonly mediaQueue: { readonly enqueue: (mediaAssetId: MediaAssetId) => Promise<void> }
  readonly events: ProjectEventPublisher
  readonly logger: Logger
}): DubProcessorDeps => ({
  dubJobs: createDubJobRepository(input.db),
  ttsClips: createTtsClipRepository(input.db),
  shots: createShotRepository(input.db),
  projects: createProjectRepository(input.db),
  characters: createCharacterRepository(input.db),
  voices: createVoiceProfileRepository(input.db),
  takes: createTakeRepository(input.db),
  mediaAssets: createMediaAssetRepository(input.db),
  storage: input.storage,
  voiceAdapter: createVoiceAdapters(audioAdapterOptions(input.config)),
  keyLabel: input.config.voiceAi.geminiKeyLabel,
  mediaQueue: input.mediaQueue,
  clipLock: createProjectClipLock(input.db),
  events: input.events,
  workDir: process.env.DUB_WORK_DIR ?? '/tmp/ixa-dub-work',
  logger: input.logger,
})
