import { join } from 'node:path'
import {
  createMediaAssetRepository,
  createMusicJobRepository,
  createMusicTrackRepository,
  createProjectRepository,
  type DbClient,
} from '@ixa/db'
import type { MediaAssetId, MusicTrackId, ProjectEventPublisher } from '@ixa/domain'
import { aceStepMusicModel, createAceStepMusicProvider } from '@ixa/provider-music'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import type { LocalGpuLease } from './generation/local-gpu-lease.js'
import type { MusicAdapter, MusicJobData, MusicProcessorDeps } from './music/index.js'

/** 手元の曲の生成サーバ（ADR-0048）。`.env` の `LOCAL_MUSIC_GENERATOR` に書いたときだけ作る（API と同じ条件）。 */
export type AceStepSettings = { readonly enabled: boolean; readonly baseUrl: string; readonly token: string | null }

const musicAdapters = (outputRoot: string, aceStep: AceStepSettings): readonly MusicAdapter[] =>
  aceStep.enabled
    ? [
        {
          provider: createAceStepMusicProvider({
            baseUrl: aceStep.baseUrl,
            token: aceStep.token,
            outputDir: join(outputRoot, 'ace-step'),
          }),
          model: aceStepMusicModel,
        },
      ]
    : []

/**
 * 曲を作る口（ADR-0048）。**どれで作るかはジョブに記されたモデルで決まる**（API が「使う AI」から決める）。
 * ここは作れる口を並べるだけ（作るだけでは通信しない）。
 */
export const createMusicWiring = (input: {
  readonly db: DbClient
  readonly storage: ObjectStorage
  readonly mediaQueue: { readonly enqueue: (mediaAssetId: MediaAssetId) => Promise<void> }
  readonly events: ProjectEventPublisher
  readonly logger: Logger
  readonly outputRoot: string
  readonly aceStep: AceStepSettings
  /** 動画・高画質化・絵と同じ整理券。 */
  readonly localGpuLease: LocalGpuLease
  /** 順番待ち・混んでいるジョブを積み直す先（music キュー）。 */
  readonly musicQueue: { readonly add: (name: string, data: MusicJobData, options: { readonly delay: number }) => Promise<unknown> }
  /** できた楽曲を解析に回す先（analysis キュー）。 */
  readonly analysisQueue: { readonly add: (name: string, data: { readonly musicTrackId: MusicTrackId }) => Promise<unknown> }
}): MusicProcessorDeps => ({
  musicJobs: createMusicJobRepository(input.db),
  projects: createProjectRepository(input.db),
  musicTracks: createMusicTrackRepository(input.db),
  mediaAssets: createMediaAssetRepository(input.db),
  storage: input.storage,
  adapters: musicAdapters(input.outputRoot, input.aceStep),
  localGpuLease: input.localGpuLease,
  scheduler: {
    reschedule: async (data, delayMs) => {
      // API と同じ名前で積む（`music`）。
      await input.musicQueue.add('music', data, { delay: delayMs })
    },
  },
  mediaQueue: input.mediaQueue,
  analysisQueue: {
    enqueue: async (musicTrackId) => {
      await input.analysisQueue.add('analyze', { musicTrackId })
    },
  },
  events: input.events,
  logger: input.logger,
})
