import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import type {
  GenerationJobRepository, MediaAssetRepository, ProjectRepository, ShotRepository, TakeRepository,
} from '@ixa/db'
import type { GenerationContextSource } from '@ixa/domain'
import type { ProviderRegistry } from '@ixa/provider-core'
import type { ObjectStorage } from '@ixa/storage'
import { registerErrorHandlers, validationHook } from './errors.js'
import type { Logger } from './logger.js'
import { registerOpenApiDocument } from './openapi.js'
import { healthRoutes } from './routes/health.js'
import { mediaRoutes } from './routes/media.js'
import { projectRoutes } from './routes/projects.js'
import { shotRoutes, type GenerationQueue } from './routes/shots.js'
import { uploadRoutes, type MediaIngestDeps } from './routes/uploads.js'
import { timelineRoutes } from './routes/timeline.js'
import { renderRoutes, type RenderQueue } from './routes/renders.js'
import { characterRoutes, shotCharacterRoutes } from './routes/characters.js'
import { assetRoutes } from './routes/assets.js'
import { scriptRoutes } from './routes/scripts.js'
import { sequenceRoutes } from './routes/sequences.js'
import { musicRoutes, type AnalysisQueue } from './routes/music.js'
import type {
  BrandAssetRepository, CharacterLookRepository, CharacterRepository, LocationRepository,
  MusicAnalysisRepository, MusicTrackRepository, RenderJobRepository, ScriptRepository,
  SequenceRepository, ShotCharacterRepository, TimelineClipRepository, TransitionRepository,
} from '@ixa/db'

/**
 * アプリが必要とする依存。DB 接続やロガーの生成はここでは行わず、
 * 呼び出し側（main.ts / テスト）から注入する。
 */
export type AppDeps = {
  projects: ProjectRepository
  mediaAssets: MediaAssetRepository
  shots: ShotRepository
  takes: TakeRepository
  generationJobs: GenerationJobRepository
  registry: ProviderRegistry
  generationContext: GenerationContextSource
  generationQueue: GenerationQueue
  transitions: TransitionRepository
  timelineClips: TimelineClipRepository
  musicTracks: MusicTrackRepository
  renderJobs: RenderJobRepository
  renderQueue: RenderQueue
  characters: CharacterRepository
  looks: CharacterLookRepository
  shotCharacters: ShotCharacterRepository
  brandAssets: BrandAssetRepository
  locations: LocationRepository
  scripts: ScriptRepository
  sequences: SequenceRepository
  musicAnalyses: MusicAnalysisRepository
  analysisQueue: AnalysisQueue
  /** media キューへの投入。未配線なら登録のみ行い queued: false を返す。 */
  mediaIngest?: MediaIngestDeps
  storage: ObjectStorage
  /** CORS で許可するオリジン。空なら CORS を有効にしない。 */
  corsOrigins: readonly string[]
  logger: Logger
}

/**
 * Hono アプリを組み立てる。
 * モジュールのトップレベルでは DB へ接続しない（テストは偽の Repository を渡す）。
 */
export const createApp = (deps: AppDeps) => {
  const { projects, mediaAssets, storage, logger } = deps
  const app = new OpenAPIHono({ defaultHook: validationHook })

  /**
   * ブラウザから API を直接叩く経路（署名付き URL の取得など）のために CORS を許可する。
   *
   * **許可先は設定で明示する。ワイルドカードを使わない。**
   * 開発中は Web の開発サーバだけを許可すれば足りる。
   */
  if (deps.corsOrigins.length > 0) {
    app.use(
      '*',
      cors({
        origin: [...deps.corsOrigins],
        allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
        maxAge: 600,
      }),
    )
  }

  app.route('/', healthRoutes())
  app.route('/', projectRoutes({ projects }))
  app.route('/', uploadRoutes({ mediaAssets, storage, mediaIngest: deps.mediaIngest }))
  app.route('/', mediaRoutes({ mediaAssets, storage }))
  app.route(
    '/',
    shotRoutes({
      shots: deps.shots,
      projects,
      takes: deps.takes,
      generationJobs: deps.generationJobs,
      registry: deps.registry,
      context: deps.generationContext,
      queue: deps.generationQueue,
    }),
  )

  /** Timeline と Render は同じ依存を使う。組み立てを 1 箇所にまとめる。 */
  const timelineDeps = {
    projects,
    shots: deps.shots,
    takes: deps.takes,
    transitions: deps.transitions,
    timelineClips: deps.timelineClips,
    musicTracks: deps.musicTracks,
    mediaAssets,
    storage,
  }

  app.route(
    '/',
    characterRoutes({ characters: deps.characters, looks: deps.looks, mediaAssets }),
  )
  app.route(
    '/',
    shotCharacterRoutes({
      shots: deps.shots,
      shotCharacters: deps.shotCharacters,
      characters: deps.characters,
      looks: deps.looks,
    }),
  )
  app.route(
    '/',
    assetRoutes({ brandAssets: deps.brandAssets, locations: deps.locations, mediaAssets }),
  )

  app.route(
    '/',
    musicRoutes({
      musicTracks: deps.musicTracks,
      musicAnalyses: deps.musicAnalyses,
      projects,
      mediaAssets,
      storage,
      queue: deps.analysisQueue,
    }),
  )
  app.route('/', scriptRoutes({ scripts: deps.scripts, projects }))
  app.route('/', sequenceRoutes({ sequences: deps.sequences, projects }))

  app.route('/', timelineRoutes(timelineDeps))
  app.route('/', renderRoutes({ ...timelineDeps, renderJobs: deps.renderJobs, queue: deps.renderQueue }))

  registerOpenApiDocument(app)
  registerErrorHandlers(app, logger)

  return app
}

export type App = ReturnType<typeof createApp>
