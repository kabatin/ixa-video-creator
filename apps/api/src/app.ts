import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import type {
  GenerationJobRepository,
  MediaAssetRepository,
  ProjectRepository,
  ShotRepository,
  TakeRepository,
  MusicAnalysisFailureRepository,
} from '@ixa/db'
import type {
  GenerationContextSource,
  ProjectEventPublisher,
  ProjectEventSubscriber,
  ProviderId,
} from '@ixa/domain'
import type { ProviderRegistry } from '@ixa/provider-core'
import type { ObjectStorage } from '@ixa/storage'
import { registerErrorHandlers, validationHook } from './errors.js'
import { environmentRoutes, type EnvironmentDeps } from './routes/environment.js'
import { aiRoutes, type AiRoutesDeps } from './routes/ai.js'
import { generationActivityRoutes, type GenerationActivityDeps } from './routes/generation-activity.js'
import { generationCancelRoutes } from './routes/generation-cancel.js'
import { takeHideRoutes } from './routes/take-hide.js'
import { lyricClipRoutes } from './routes/lyric-clips.js'
import { assistRoutes } from './routes/assist.js'
import { modelRoutes } from './routes/models.js'
import type { Logger } from './logger.js'
import { registerOpenApiDocument } from './openapi.js'
import { healthRoutes } from './routes/health.js'
import { mediaRoutes } from './routes/media.js'
import { projectRoutes } from './routes/projects.js'
import { shotRoutes, type GenerationQueue } from './routes/shots.js'
import { shotBulkRoutes } from './routes/shots-bulk.js'
import { shotEditRoutes } from './routes/shot-edits.js'
import { shotStartFrameRoutes } from './routes/shot-start-frame.js'
import { shotStartFrameGenerateRoutes, type StartFrameGenerateRoutesDeps } from './routes/shot-start-frame-generate.js'
import { shotTakeImportRoutes } from './routes/shot-take-import.js'
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
import { clipTextStyleRoutes } from './routes/clip-text-style.js'
import { textStyleRoutes } from './routes/text-styles.js'
import { eventRoutes } from './routes/events.js'
import type { StoryboardDrafter, TextAssistant } from '@ixa/provider-llm'
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
  ShotReferenceRepository,
  TextStyleRepository,
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
  /** いま選んでいる動画の AI（ADR-0032）。AUTO はこの中から選ぶ。 */
  videoProvider: () => Promise<ProviderId>
  generationContext: GenerationContextSource
  generationQueue: GenerationQueue
  transitions: TransitionRepository
  timelineClips: TimelineClipRepository
  /** 名前を付けて保存したテロップの見た目（ADR-0028）。 */
  textStyles: TextStyleRepository
  musicTracks: MusicTrackRepository
  renderJobs: RenderJobRepository
  renderQueue: RenderQueue
  characters: CharacterRepository
  looks: CharacterLookRepository
  shotCharacters: ShotCharacterRepository
  /** 手動の参照（いまは最初のフレームだけ・ADR-0025）。 */
  shotReferences: ShotReferenceRepository
  /** 絵コンテの画像を作るジョブ（ADR-0029）。 */
  imageJobs: StartFrameGenerateRoutesDeps['imageJobs']
  imageQueue: StartFrameGenerateRoutesDeps['imageQueue']
  /** どの口で作るか（`IMAGE_PROVIDER` から main.ts が決める）。 */
  imageModel: StartFrameGenerateRoutesDeps['imageModel']
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
  storyboardDrafter: () => Promise<StoryboardDrafter>
  /** 入力を手伝う口（欄の「✦ AI」。ADR-0032 の 3 段目）。使うたびに「使う AI」のテキストで選ぶ。 */
  textAssistant: () => Promise<TextAssistant>
  sequences: SequenceRepository
  musicAnalyses: MusicAnalysisRepository
  /** 解析の失敗（worker が書く）。画面が「まだ」と「失敗」を分けるために読む。 */
  musicAnalysisFailures: MusicAnalysisFailureRepository
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
  /**
   * この環境の状態を返す口（`describeEnvironment(config)`）。
   * **app 層が config を直接読まない。** 注入して、テストから差し替えられるようにする。
   */
  environment?: EnvironmentDeps
  /** 使う AI（ADR-0032）。無ければ口を置かない（テストの多くは要らない）。 */
  ai?: AiRoutesDeps
  /** 動いている生成（順番待ち・作成中）の一覧。無ければ口を置かない。 */
  activeGenerations?: GenerationActivityDeps['activeJobs']
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
        // 画面の Requester が使うメソッドはすべて（PUT を落としていて「使う AI」の保存と最初のフレームが止まっていた）。
        allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
        maxAge: 600,
      }),
    )
  }

  app.route('/', healthRoutes())
  // 鍵の設定状態。**値は返さない。設定する口も置かない**（無認証で全 IF に待ち受けているため）。
  if (deps.environment !== undefined) app.route('/', environmentRoutes(deps.environment))
  if (deps.ai !== undefined) app.route('/', aiRoutes(deps.ai))
  if (deps.activeGenerations !== undefined) {
    app.route(
      '/',
      generationActivityRoutes({
        projects: deps.projects,
        activeJobs: deps.activeGenerations,
        shots: deps.shots,
        registry: deps.registry,
      }),
    )
  }
  // 画面がモデルの性質（fps・尺・参照の上限）を書き写さないための口。
  app.route('/', modelRoutes({ registry: deps.registry }))
  app.route(
    '/',
    // 費用の出どころ判定は **過去の事実**。今 registry にいる Provider と突き合わせない
    // （外した瞬間に過去の Take が「実測」に化ける）。素性の一覧を app 層が注入する。
    projectRoutes({
      projects,
      // 作品の手本画像（ADR-0030）の検査に使う。
      mediaAssets,
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
    videoProvider: deps.videoProvider,
    context: deps.generationContext,
    queue: deps.generationQueue,
    events: deps.events,
    logger,
  }
  app.route('/', shotRoutes(shotDeps))
  app.route('/', generationCancelRoutes(shotDeps))
  app.route('/', takeHideRoutes(shotDeps))
  app.route(
    '/',
    assistRoutes({
      projects,
      shots: deps.shots,
      scripts: deps.scripts,
      characters: deps.characters,
      looks: deps.looks,
      locations: deps.locations,
      textAssistant: deps.textAssistant,
      logger,
    }),
  )
  // 一括変更だけが記録を作る。1 件ずつの変更は戻す対象にしない（横断 ROADMAP）。
  app.route('/', shotBulkRoutes({ ...shotDeps, editBatches: deps.editBatches }))
  app.route(
    '/',
    shotEditRoutes({
      shots: deps.shots,
      projects,
      takes: deps.takes,
      shotCharacters: deps.shotCharacters,
    }),
  )
  app.route(
    '/',
    shotStartFrameRoutes({
      shots: deps.shots,
      projects,
      mediaAssets,
      shotReferences: deps.shotReferences,
      imageJobs: deps.imageJobs,
    }),
  )
  // 絵コンテの画像を作る（ADR-0029）。作るのは worker。
  app.route(
    '/',
    shotStartFrameGenerateRoutes({
      shots: deps.shots,
      projects,
      shotReferences: deps.shotReferences,
      imageJobs: deps.imageJobs,
      imageQueue: deps.imageQueue,
      imageModel: deps.imageModel,
      events: deps.events,
      logger,
    }),
  )
  // 手持ちの動画を Take にする（ADR-0026）。
  app.route(
    '/',
    shotTakeImportRoutes({
      shots: deps.shots,
      projects,
      mediaAssets,
      takes: deps.takes,
      events: deps.events,
      logger,
    }),
  )
  app.route(
    '/',
    shotPosterRoutes({
      shots: deps.shots,
      takes: deps.takes,
      mediaAssets,
      projects,
      storage,
      shotReferences: deps.shotReferences,
      imageJobs: deps.imageJobs,
    }),
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
    shotReferences: deps.shotReferences,
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
      analysisFailures: deps.musicAnalysisFailures,
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
  // テロップの見た目: 名前を付けて保存し、まとめて当てる（ADR-0028）。
  app.route('/', textStyleRoutes({ textStyles: deps.textStyles, projects }))
  // 歌詞をフレーズごとのテロップにする（ADR-0033）。
  app.route(
    '/',
    lyricClipRoutes({
      projects,
      shots: deps.shots,
      timelineClips: deps.timelineClips,
      textStyles: deps.textStyles,
    }),
  )
  app.route(
    '/',
    clipTextStyleRoutes({ textStyles: deps.textStyles, projects, timelineClips: deps.timelineClips }),
  )

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
