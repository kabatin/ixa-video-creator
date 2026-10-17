import { join } from 'node:path'
import {
  createMediaAssetRepository,
  createProjectRepository,
  createSfxJobRepository,
  createTimelineClipRepository,
  type DbClient,
} from '@ixa/db'
import type { MediaAssetId, ProjectEventPublisher } from '@ixa/domain'
import { SFX_API_MODELS, createSfxApiProvider } from '@ixa/provider-music'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import type { LocalGpuLease } from './generation/local-gpu-lease.js'
import type { SfxAdapter, SfxJobData, SfxProcessorDeps } from './sfx/index.js'

/** 手元の効果音の生成サーバ（ADR-0052）。`.env` の `LOCAL_SFX_GENERATOR` に書いたときだけ作る（API と同じ条件）。 */
export type SfxApiSettings = { readonly enabled: boolean; readonly baseUrl: string; readonly token: string | null }

/** 1 台の sfx-api が 2 つのモデル（Stable Audio 3・MOSS）を出す。口は 1 つで、モデルごとに並べる。 */
const sfxAdapters = (outputRoot: string, sfxApi: SfxApiSettings): readonly SfxAdapter[] => {
  if (!sfxApi.enabled) return []
  const provider = createSfxApiProvider({
    baseUrl: sfxApi.baseUrl,
    token: sfxApi.token,
    outputDir: join(outputRoot, 'sfx-api'),
  })
  return SFX_API_MODELS.map((model) => ({ provider, model }))
}

/**
 * 効果音を作る口（ADR-0052）。**どれで作るかはジョブに記されたモデルで決まる**（API が「使う AI」から決める）。
 * ここは作れる口を並べるだけ（作るだけでは通信しない）。
 */
export const createSfxWiring = (input: {
  readonly db: DbClient
  readonly storage: ObjectStorage
  readonly mediaQueue: { readonly enqueue: (mediaAssetId: MediaAssetId) => Promise<void> }
  readonly events: ProjectEventPublisher
  readonly logger: Logger
  readonly outputRoot: string
  readonly sfxApi: SfxApiSettings
  /** 動画・高画質化・絵・曲と同じ整理券。 */
  readonly localGpuLease: LocalGpuLease
  /** 順番待ち・混んでいるジョブを積み直す先（sfx キュー）。 */
  readonly sfxQueue: { readonly add: (name: string, data: SfxJobData, options: { readonly delay: number }) => Promise<unknown> }
}): SfxProcessorDeps => ({
  sfxJobs: createSfxJobRepository(input.db),
  projects: createProjectRepository(input.db),
  mediaAssets: createMediaAssetRepository(input.db),
  timelineClips: createTimelineClipRepository(input.db),
  storage: input.storage,
  adapters: sfxAdapters(input.outputRoot, input.sfxApi),
  localGpuLease: input.localGpuLease,
  scheduler: {
    reschedule: async (data, delayMs) => {
      // API と同じ名前で積む（`sfx`）。
      await input.sfxQueue.add('sfx', data, { delay: delayMs })
    },
  },
  mediaQueue: input.mediaQueue,
  events: input.events,
  logger: input.logger,
})
