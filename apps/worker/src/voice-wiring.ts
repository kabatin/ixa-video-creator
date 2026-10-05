import type { AppConfig } from '@ixa/config'
import {
  createMediaAssetRepository,
  createNarrationLineRepository,
  createNarrationTakeRepository,
  createProjectAudioSettingsRepository,
  createProjectRepository,
  createVoiceJobRepository,
  type DbClient,
} from '@ixa/db'
import { voiceCostRules, type MediaAssetId, type ProjectEventPublisher } from '@ixa/domain'
import { normalizeVoice, probeMedia, readPeaks, toWhisperWav } from '@ixa/media'
import { execFileCliRunner } from '@ixa/provider-core'
import { createTranscribers, createVoiceAdapters, type AudioAdapterOptions } from '@ixa/provider-voice'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import type { VoiceProcessorDeps } from './voice/index.js'

/**
 * ナレーションの声と文字起こし（ADR-0038）。どの AI で読むかはジョブ（声の指定）に記されている。
 * ここは口を並べるだけ。外部 API の口は、鍵があって AUDIO_API_PROVIDERS に書いたときだけ作る（API と同じ表）。
 * 掛かった額は domain の規則（voiceCostRules）で出す（無料枠・2027 年の値上げ・プランの単価）。
 */
export const audioAdapterOptions = (config: AppConfig): AudioAdapterOptions => {
  const costs = voiceCostRules({
    geminiBilling: config.voiceAi.geminiBilling,
    elevenLabsUsdPer1kChars: config.voiceAi.elevenLabsUsdPer1kChars,
    now: () => new Date(),
  })
  return {
    runCli: execFileCliRunner,
    fetch: (url, init) => fetch(url, init),
    convertForWhisper: toWhisperWav,
    gemini: {
      apiKey: config.voiceAi.geminiApiKey,
      enabled: config.voiceAi.apiProviders.includes('gemini_api'),
      ttsCostOf: ({ model, outputTokens }) => costs.geminiTts({ model, outputTokens }),
      transcribeCostOf: (durationSec) => costs.transcribe('gemini_api', durationSec),
    },
    elevenLabs: {
      apiKey: config.voiceAi.elevenLabsApiKey,
      enabled: config.voiceAi.apiProviders.includes('elevenlabs'),
      ttsCostOf: ({ chars }) => costs.elevenLabsTts(chars),
      transcribeCostOf: (durationSec) => costs.transcribe('elevenlabs', durationSec),
    },
    whisperCppModel: config.voiceAi.whisperCppModel,
  }
}

export const createVoiceWiring = (input: {
  readonly config: AppConfig
  readonly db: DbClient
  readonly storage: ObjectStorage
  readonly mediaQueue: { readonly enqueue: (mediaAssetId: MediaAssetId) => Promise<void> }
  readonly events: ProjectEventPublisher
  readonly logger: Logger
}): VoiceProcessorDeps => {
  const options = audioAdapterOptions(input.config)
  return {
    voiceJobs: createVoiceJobRepository(input.db),
    lines: createNarrationLineRepository(input.db),
    takes: createNarrationTakeRepository(input.db),
    audioSettings: createProjectAudioSettingsRepository(input.db),
    projects: createProjectRepository(input.db),
    mediaAssets: createMediaAssetRepository(input.db),
    storage: input.storage,
    voiceAdapter: createVoiceAdapters(options),
    transcriber: createTranscribers(options),
    audio: {
      normalize: normalizeVoice,
      durationSec: async (path) => (await probeMedia(path)).durationSec ?? 0,
      peaks: readPeaks,
    },
    mediaQueue: input.mediaQueue,
    events: input.events,
    workDir: process.env.VOICE_WORK_DIR ?? '/tmp/ixa-voice-work',
    logger: input.logger,
  }
}
