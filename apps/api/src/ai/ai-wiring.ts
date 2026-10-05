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
import { codexCliImageModel, stubGeminiLikeImageModel } from '@ixa/provider-image'
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
import { checkVpipeHealth } from '@ixa/provider-video'
import type { AiRoutesDeps } from '../routes/ai.js'
import { detectAiTools, type WhisperModelState } from './detect-ai-tools.js'

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
  }
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
        localServer: {
          enabled: config.providers.localVideoGenerator === 'vpipe',
          check: () =>
            checkVpipeHealth({
              baseUrl: config.providers.vpipeApiUrl,
              token: config.providers.vpipeApiToken,
            }),
        },
      }),
    current,
    storyboardDrafter: async () =>
      adapterFor(drafters, (await current()).text, 'テキスト（絵コンテの案）'),
    textAssistant: async () => adapterFor(assistants, (await current()).text, 'テキスト（入力の手伝い）'),
    imageModel: async () => adapterFor(imageModels, (await current()).image, '画像'),
    videoProvider: async () => ProviderIdSchema.parse((await current()).video),
  }
}
