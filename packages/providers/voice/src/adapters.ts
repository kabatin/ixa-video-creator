import type { VoiceToolId } from '@ixa/domain'
import type { CliRunner, TranscribeToolId, Transcriber, VoiceAdapter } from '@ixa/provider-core'
import { createElevenLabsTranscriber, createElevenLabsVoice } from './elevenlabs.js'
import { createGeminiTranscriber, createGeminiVoice } from './gemini.js'
import type { FetchLike } from './http.js'
import { createMacosSayVoice } from './macos-say.js'
import { createStubTranscriber, createStubVoice } from './stub.js'
import { createWhisperCppTranscriber } from './whisper-cpp.js'

/**
 * 声と文字起こしの AI の表（ADR-0038）。API（声の一覧）と worker（声にする・聞き取る）で同じ表を使う
 * （どの AI に口があるかの規則を 2 か所に書かない）。
 *
 * **鍵があっても、使ってよいと明示していない外部 API の口は作らない**（`AUDIO_API_PROVIDERS`）。
 */

export type ExternalAudioApi = {
  readonly apiKey: string | null
  /** `.env` の AUDIO_API_PROVIDERS に書いてあるか。 */
  readonly enabled: boolean
  readonly ttsCostOf: (usage: { readonly model: string; readonly outputTokens: number; readonly chars: number }) => number
  readonly transcribeCostOf: (durationSec: number) => number
}

export type AudioAdapterOptions = {
  readonly runCli: CliRunner
  readonly fetch: FetchLike
  /** 音を whisper.cpp 向けの 16kHz・モノラルの WAV にする（ffmpeg）。 */
  readonly convertForWhisper: (inputPath: string, outputPath: string) => Promise<void>
  readonly gemini: ExternalAudioApi
  readonly elevenLabs: ExternalAudioApi
  readonly whisperCppModel: string | null
}

const keyOf = (api: ExternalAudioApi): string | null => (api.enabled ? api.apiKey : null)

export const createVoiceAdapters = (options: AudioAdapterOptions): ((tool: VoiceToolId) => VoiceAdapter | null) => {
  const geminiKey = keyOf(options.gemini)
  const elevenKey = keyOf(options.elevenLabs)
  const table: Partial<Record<VoiceToolId, VoiceAdapter>> = {
    stub: createStubVoice(),
    macos_say: createMacosSayVoice({ runCli: options.runCli }),
    ...(geminiKey === null
      ? {}
      : {
          gemini_api: createGeminiVoice({
            apiKey: geminiKey,
            fetch: options.fetch,
            costOf: ({ model, outputTokens }) => options.gemini.ttsCostOf({ model, outputTokens, chars: 0 }),
          }),
        }),
    ...(elevenKey === null
      ? {}
      : {
          elevenlabs: createElevenLabsVoice({
            apiKey: elevenKey,
            fetch: options.fetch,
            costOf: (chars) => options.elevenLabs.ttsCostOf({ model: '', outputTokens: 0, chars }),
          }),
        }),
  }
  return (tool) => table[tool] ?? null
}

export const createTranscribers = (options: AudioAdapterOptions): ((tool: TranscribeToolId) => Transcriber | null) => {
  const geminiKey = keyOf(options.gemini)
  const elevenKey = keyOf(options.elevenLabs)
  const table: Partial<Record<TranscribeToolId, Transcriber>> = {
    stub: createStubTranscriber(),
    ...(options.whisperCppModel === null
      ? {}
      : {
          whisper_cpp: createWhisperCppTranscriber({
            modelPath: options.whisperCppModel,
            runCli: options.runCli,
            convert: options.convertForWhisper,
          }),
        }),
    ...(geminiKey === null
      ? {}
      : { gemini_api: createGeminiTranscriber({ apiKey: geminiKey, fetch: options.fetch, costOf: options.gemini.transcribeCostOf }) }),
    ...(elevenKey === null
      ? {}
      : {
          elevenlabs: createElevenLabsTranscriber({ apiKey: elevenKey, fetch: options.fetch, costOf: options.elevenLabs.transcribeCostOf }),
        }),
  }
  return (tool) => table[tool] ?? null
}
