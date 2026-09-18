import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import type {
  GenerationJobRepository,
  MediaAssetRepository,
  ProjectRepository,
  ShotRepository,
  TakeRepository,
} from '@ixa/db'
import type {
  GenerationContextSource,
  ProjectEventPublisher,
  ProjectEventSubscriber,
} from '@ixa/domain'
import type { ProviderRegistry } from '@ixa/provider-core'
import type { ObjectStorage } from '@ixa/storage'
import { registerErrorHandlers, validationHook } from './errors.js'
import type { Logger } from './logger.js'
import { registerOpenApiDocument } from './openapi.js'
import { healthRoutes } from './routes/health.js'
import { mediaRoutes } from './routes/media.js'
import { projectRoutes } from './routes/projects.js'
import { shotRoutes, type GenerationQueue } from './routes/shots.js'
import { shotBulkRoutes } from './routes/shots-bulk.js'
import { shotPosterRoutes } from './routes/shot-posters.js'
import { uploadRoutes, type MediaIngestDeps } from './routes/uploads.js'
import { shotCompareRoutes } from './routes/shot-compare.js'
import { beatAlignmentRoutes, roughCutRoutes, timelineRoutes } from './routes/timeline.js'
import { renderRoutes, type RenderQueue } from './routes/renders.js'
import { characterRoutes, shotCharacterRoutes } from './routes/characters.js'
import { assetRoutes } from './routes/assets.js'
import { scriptRoutes } from './routes/scripts.js'
import { sequenceRoutes } from './routes/sequences.js'
import { musicRoutes, type AnalysisQueue } from './routes/music.js'
import { editBatchRoutes } from './routes/edit-batches.js'
import { storyboardDraftRoutes } from './routes/storyboard-drafts.js'
import { storyboardRoutes } from './routes/storyboard.js'
import { reviewRoutes, type ReviewQueue } from './routes/reviews.js'
import { transitionRoutes } from './routes/transitions.js'
import { clipRoutes } from './routes/clips.js'
import { eventRoutes } from './routes/events.js'
import type { StoryboardDrafter } from '@ixa/provider-llm'
import { STUB_PROVIDER_IDS } from '@ixa/provider-video'
import type {
  BrandAssetRepository,
  CharacterLookRepository,
  CharacterRepository,
  LocationRepository,
  MusicAnalysisRepository,
  MusicTrackRepository,
  RenderJobRepository,
  ReviewRepository,
  EditBatchRepository,
  ScriptRepository,
  StoryboardDraftRepository,
  SequenceRepository,
  ShotCharacterRepository,
  TimelineClipRepository,
  TransitionRepository,
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
  storyboardDrafts: StoryboardDraftRepository
  /** 一括編集の記録と取り消し（Undo と履歴）。 */
  editBatches: EditBatchRepository
  /**
   * 絵コンテ下書きの口。**どの実装を挿すかは main.ts だけが決める**
   * （レビュアと同じ方針。`apps/worker/src/review-wiring.ts`）。
   * テストはスタブを渡すので、実 CLI が CI で走ることはない。
   */
  storyboardDrafter: StoryboardDrafter
  sequences: SequenceRepository
  musicAnalyses: MusicAnalysisRepository
  analysisQueue: AnalysisQueue
  reviews: ReviewRepository
  reviewQueue: ReviewQueue
  /**
   * Project の出来事を流す・受ける口（PHASE 5.8b）。publish と subscribe の両方を
   * 同じ実体が持つ。Shot の経路は流し、SSE の経路は受ける。実体は main.ts が注入する。
   */
  events: ProjectEventPublisher & ProjectEventSubscriber
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
  app.route(
    '/',
    // 費用の出どころ判定は **過去の事実**。今 registry にいる Provider と突き合わせない
    // （外した瞬間に過去の Take が「実測」に化ける）。素性の一覧を app 層が注入する。
    projectRoutes({
      projects,
      // 行として出せる Shot を知るために引く。**額の合計には使わない**
      // （削除済み Shot の Take も払った額なので、合計は takes.findByProject が数える）。
      shots: deps.shots,
      takes: deps.takes,
      storyboardDrafts: deps.storyboardDrafts,
      reviews: deps.reviews,
      stubProviderIds: [...STUB_PROVIDER_IDS],
    }),
  )
  app.route('/', uploadRoutes({ mediaAssets, storage, mediaIngest: deps.mediaIngest }))
  app.route('/', mediaRoutes({ mediaAssets, storage }))
  /** 1 件の経路と一括の経路は同じ依存を使う。組み立てを 1 箇所にまとめる。 */
  const shotDeps = {
    shots: deps.shots,
    projects,
    takes: deps.takes,
    generationJobs: deps.generationJobs,
    registry: deps.registry,
    context: deps.generationContext,
    queue: deps.generationQueue,
    events: deps.events,
    logger,
  }
  app.route('/', shotRoutes(shotDeps))
  // 一括変更だけが記録を作る。1 件ずつの変更は戻す対象にしない（横断 ROADMAP）。
  app.route('/', shotBulkRoutes({ ...shotDeps, editBatches: deps.editBatches }))
  app.route(
    '/',
    shotPosterRoutes({ shots: deps.shots, takes: deps.takes, mediaAssets, projects, storage }),
  )
  app.route('/', eventRoutes({ projects, events: deps.events, logger }))

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

  app.route('/', characterRoutes({ characters: deps.characters, looks: deps.looks, mediaAssets }))
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

  // 絵コンテの下書き（PHASE 6.3）。どの口を挿すかは main.ts が決める。
  app.route(
    '/',
    storyboardDraftRoutes({
      projects,
      shots: deps.shots,
      scripts: deps.scripts,
      musicTracks: deps.musicTracks,
      musicAnalyses: deps.musicAnalyses,
      drafts: deps.storyboardDrafts,
      editBatches: deps.editBatches,
      drafter: deps.storyboardDrafter,
    }),
  )
  app.route('/', sequenceRoutes({ sequences: deps.sequences, projects }))
  app.route(
    '/',
    storyboardRoutes({
      shots: deps.shots,
      musicTracks: deps.musicTracks,
      musicAnalyses: deps.musicAnalyses,
      sequences: deps.sequences,
      projects,
    }),
  )

  app.route(
    '/',
    reviewRoutes({ takes: deps.takes, reviews: deps.reviews, queue: deps.reviewQueue }),
  )

  app.route('/', transitionRoutes({ transitions: deps.transitions, shots: deps.shots, projects }))
  app.route('/', clipRoutes({ timelineClips: deps.timelineClips, projects, mediaAssets }))

  app.route('/', timelineRoutes(timelineDeps))
  // A/B 比較は書き出しと同じ素材の集め方を使うので、Timeline と同じ依存に解析を 1 つ足すだけ。
  app.route('/', shotCompareRoutes({ ...timelineDeps, musicAnalyses: deps.musicAnalyses }))
  // 拍とのズレ。この口だけ解析が要るので factory を分けてある（既存の配線を壊さない）。
  app.route(
    '/',
    beatAlignmentRoutes({ ...timelineDeps, musicAnalyses: deps.musicAnalyses }),
  )
  // 粗編集。plan は何も書かず、apply は **人が見た案をそのまま**受け取って適用する。
  app.route(
    '/',
    roughCutRoutes({
      ...timelineDeps,
      musicAnalyses: deps.musicAnalyses,
      editBatches: deps.editBatches,
    }),
  )

  // 一括で変えた記録と、その取り消し（横断 ROADMAP: Undo と履歴）。
  app.route(
    '/',
    editBatchRoutes({ projects, shots: deps.shots, editBatches: deps.editBatches }),
  )
  app.route(
    '/',
    renderRoutes({ ...timelineDeps, renderJobs: deps.renderJobs, queue: deps.renderQueue }),
  )

  registerOpenApiDocument(app)
  registerErrorHandlers(app, logger)

  return app
}

export type App = ReturnType<typeof createApp>
