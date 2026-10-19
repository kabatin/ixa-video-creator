import { access, constants } from 'node:fs/promises'
import type { AppConfig } from '@ixa/config'
import { createAiSettingsRepository, type DbClient } from '@ixa/db'
import {
  ProviderId as ProviderIdSchema,
  aiDefaultsFromEnv,
  resolveAiSettings,
  type AiSettings,
  type AiToolId,
  type ModelId,
  type ProviderId,
} from '@ixa/domain'
import { execFileCliRunner } from '@ixa/provider-core'
import {
  ACE_STEP_IDENTITY,
  checkSfxApiHealth,
  aceStepMusicModel,
  stableAudioMusicModel,
} from '@ixa/provider-music'
import { KLEIN_IDENTITY, codexCliImageModel, kleinImageModel, stubGeminiLikeImageModel } from '@ixa/provider-image'
import {
  createClaudeCliStoryboardDrafter,
  createStubAssistant,
  createStubStoryboardDrafter,
  createTextCli,
  createTextCliAssistant,
  createTextCliStoryboardDrafter,
  type StoryboardDrafter,
  type TextAssistant,
} from '@ixa/provider-llm'
import { checkLocalServerHealth, localVideoServerWirings } from '@ixa/provider-video'
import { chooseMusicModel, type MusicModelChoice } from '../music/music-model.js'
import { chooseSfxModel, sfxModelsFor, type SfxModelChoice } from '../sfx/sfx-model.js'
import type { AiRoutesDeps } from '../routes/ai.js'
import { detectAiTools, type LocalServerName, type LocalServerProbe, type WhisperModelState } from './detect-ai-tools.js'

type ImageModelRef = { readonly providerId: ProviderId; readonly modelId: ModelId }

export type AiWiring = AiRoutesDeps & {
  /** いま使う AI。**使うたびに読む**（画面で選び直したら次の 1 回から効く）。 */
  readonly current: () => Promise<AiSettings>
  /** いま選んでいるテキストの AI の、絵コンテの案の口。 */
  readonly storyboardDrafter: () => Promise<StoryboardDrafter>
  /** いま選んでいるテキストの AI の、入力を手伝う口（欄の「✦ AI」。ADR-0032 の 3 段目）。 */
  readonly textAssistant: () => Promise<TextAssistant>
  /** いま選んでいる画像の AI（ジョブに記し、worker がその口で作る）。 */
  readonly imageModel: () => Promise<ImageModelRef>
  /** いま選んでいる動画の AI。AUTO はこの Provider のモデルの中から選ぶ（Provider の id は AI の id と同じ）。 */
  readonly videoProvider: () => Promise<ProviderId>
  /** いま選んでいる曲の AI で作れるか（ADR-0048）。ジョブに記し、worker がその口で作る。 */
  readonly musicModel: () => Promise<MusicModelChoice>
  /** 効果音の AI で作れるか（ADR-0052）。`tool` を渡せばその AI、省略すれば選んでいるもの。 */
  readonly sfxModel: (tool?: AiToolId) => Promise<SfxModelChoice>
}

const adapterFor = <T>(table: Partial<Record<AiToolId, T>>, id: AiToolId, what: string): T => {
  const adapter = table[id]
  if (adapter === undefined)
    throw new Error(`${what}に「${id}」の口がありません。「使う AI」で選び直してください`)
  return adapter
}

/** whisper.cpp のモデルのファイルがあるか。読めるかだけを見る（中身は開かない）。 */
const whisperModelState = async (path: string | null): Promise<WhisperModelState> => {
  if (path === null) return 'not_configured'
  try {
    await access(path, constants.R_OK)
    return 'ready'
  } catch {
    return 'file_missing'
  }
}

/**
 * 手元の生成サーバ（ADR-0031 / 0040）の見つけ方。**サーバごとに持つ。**
 * 一覧は Provider 側の表（`localVideoServerWirings`）から作るので、登録の条件と必ず揃う。
 */
const localServerProbes = (config: AppConfig): Readonly<Record<LocalServerName, LocalServerProbe>> => {
  const wirings = localVideoServerWirings({
    enabled: config.providers.localVideoGenerators,
    vpipe: { baseUrl: config.providers.vpipeApiUrl, token: config.providers.vpipeApiToken },
    wan: { baseUrl: config.providers.wanApiUrl, token: config.providers.wanApiToken },
  })
  const probeFor = (id: 'vpipe' | 'wan'): LocalServerProbe => {
    const wiring = wirings.find((candidate) => candidate.id === id)
    if (wiring === undefined) throw new Error(`手元の生成サーバ ${id} の配線がありません`)
    return { enabled: wiring.enabled, enabledBy: 'LOCAL_VIDEO_GENERATOR', check: () => wiring.checkHealth() }
  }
  // 画像のサーバ（ADR-0047）。動画の表（`localVideoServerWirings`）には入れない（Provider の種類が違う）。
  const klein: LocalServerProbe = {
    enabled: config.providers.localImageGenerators.includes('klein'),
    enabledBy: 'LOCAL_IMAGE_GENERATOR',
    check: () =>
      checkLocalServerHealth({
        identity: KLEIN_IDENTITY,
        baseUrl: config.providers.kleinApiUrl,
        token: config.providers.kleinApiToken,
      }),
  }
  // 曲のサーバ（ADR-0048）。画像と同じく動画の表には入れない。
  const aceStep: LocalServerProbe = {
    enabled: config.providers.localMusicGenerators.includes('ace_step'),
    enabledBy: 'LOCAL_MUSIC_GENERATOR',
    check: () =>
      checkLocalServerHealth({
        identity: ACE_STEP_IDENTITY,
        baseUrl: config.providers.aceStepApiUrl,
        token: config.providers.aceStepApiToken,
      }),
  }
  // 効果音のサーバ（ADR-0052）。1 台で Stable Audio（Medium・Small）と MOSS、曲の Stable Audio を出すので、どの AI もこれで見つける。
  const sfxApi: LocalServerProbe = {
    enabled: config.providers.localSfxGenerators.includes('sfx_api'),
    enabledBy: 'LOCAL_SFX_GENERATOR',
    // workflow ごとに見る（片方だけ重みが無い・読み込めないことがある）。
    check: (workflowId) =>
      checkSfxApiHealth({
        baseUrl: config.providers.sfxApiUrl,
        token: config.providers.sfxApiToken,
        ...(workflowId === undefined ? {} : { workflowId }),
      }),
  }
  // **一覧をそのまま畳まず、ここは必ず明示で書く。** 畳むと AI が増えたときに
  // 「その AI の調べ方が無い」ことに型が気付かず、画面を開いた瞬間に落ちる。
  return { vpipe: probeFor('vpipe'), wan: probeFor('wan'), klein, ace_step: aceStep, sfx_api: sfxApi }
}

/** 使う AI（ADR-0032）の配線。見つけ方・保存先・初期値をここで 1 度だけ決める。 */
export const createAiWiring = (config: AppConfig, db: DbClient): AiWiring => {
  const repository = createAiSettingsRepository(db)
  const defaults = aiDefaultsFromEnv({
    storyboardDrafter: config.storyboardDrafter,
    imageProvider: config.imageProvider,
  })
  const current = async (): Promise<AiSettings> =>
    resolveAiSettings(await repository.get(), defaults).settings
  /**
   * 用途ごとの口。**`AI_TOOLS` の purposes と揃える**（選べるのに口が無い、を作らない）。
   * 生成 API のような従量課金ではないが、CLI は制作者の契約の利用枠を使う。
   */
  const codex = createTextCli('codex')
  const grok = createTextCli('grok')
  const drafters: Partial<Record<AiToolId, StoryboardDrafter>> = {
    stub: createStubStoryboardDrafter(),
    claude_cli: createClaudeCliStoryboardDrafter(),
    codex_cli: createTextCliStoryboardDrafter(codex),
    grok_cli: createTextCliStoryboardDrafter(grok),
  }
  const assistants: Partial<Record<AiToolId, TextAssistant>> = {
    stub: createStubAssistant(),
    claude_cli: createTextCliAssistant(createTextCli('claude')),
    codex_cli: createTextCliAssistant(codex),
    grok_cli: createTextCliAssistant(grok),
  }
  const imageModels: Partial<Record<AiToolId, ImageModelRef>> = {
    stub: { providerId: stubGeminiLikeImageModel.providerId, modelId: stubGeminiLikeImageModel.id },
    codex_cli: { providerId: codexCliImageModel.providerId, modelId: codexCliImageModel.id },
    klein: { providerId: kleinImageModel.providerId, modelId: kleinImageModel.id },
  }
  // 曲（ADR-0048）。`.env` で有効にしていなければ null（選べても作れない理由を言う）。
  // Stable Audio の歌なし BGM は効果音と同じ sfx-api なので、効果音のサーバの有効・無効に従う。
  const musicModels = {
    ace_step: config.providers.localMusicGenerators.includes('ace_step') ? aceStepMusicModel.id : null,
    stable_audio_medium_music: config.providers.localSfxGenerators.includes('sfx_api') ? stableAudioMusicModel.id : null,
  }
  // 効果音（ADR-0052）。同じ sfx-api の別の workflow。`.env` で有効にしていなければ null。
  const sfxModels = sfxModelsFor(config.providers.localSfxGenerators.includes('sfx_api'))
  return {
    settings: repository,
    defaults,
    detect: () =>
      detectAiTools({
        runCli: execFileCliRunner,
        apiKeys: {
          FAL_API_KEY: {
            keyConfigured: config.providers.falApiKey !== null,
            enabled: config.providers.falApiKey !== null && config.providers.videoProvider === 'fal',
          },
          GEMINI_API_KEY: {
            keyConfigured: config.voiceAi.geminiApiKey !== null,
            enabled: config.voiceAi.geminiApiKey !== null && config.voiceAi.apiProviders.includes('gemini_api'),
          },
          ELEVENLABS_API_KEY: {
            keyConfigured: config.voiceAi.elevenLabsApiKey !== null,
            enabled: config.voiceAi.elevenLabsApiKey !== null && config.voiceAi.apiProviders.includes('elevenlabs'),
          },
        },
        whisperModel: () => whisperModelState(config.voiceAi.whisperCppModel),
        localServers: localServerProbes(config),
      }),
    current,
    storyboardDrafter: async () =>
      adapterFor(drafters, (await current()).text, 'テキスト（絵コンテの案）'),
    textAssistant: async () => adapterFor(assistants, (await current()).text, 'テキスト（入力の手伝い）'),
    imageModel: async () => adapterFor(imageModels, (await current()).image, '画像'),
    videoProvider: async () => ProviderIdSchema.parse((await current()).video),
    musicModel: async () => chooseMusicModel((await current()).music, musicModels),
    sfxModel: async (tool) => chooseSfxModel(tool ?? (await current()).sfx, sfxModels),
  }
}
