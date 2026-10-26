import { VoiceProviderError } from '@ixa/provider-core'
import { z } from 'zod'
import { GEMINI_DEFAULT_TTS_MODEL } from './gemini.js'
import { geminiPostJson, type GeminiRequestDeps } from './gemini-request.js'

/**
 * 声を説明から作る（Voice Design。ADR-0062）。`v1beta/voices` に説明を送ると `voice_…` の ID と試し聞きが返る。
 *
 * - **作った鍵のプロジェクトでしか使えない**（別の鍵では 404）。最後に使ってから 1 年残る
 * - 呼ぶのは制作者が画面で押したときだけ（課金）。形は AnimalVideo（tools/dub/gemini.py）から写した
 */

export const GEMINI_VOICES_URL = 'https://generativelanguage.googleapis.com/v1beta/voices'

export const VoiceDesignGender = z.enum(['female', 'male'])
export type VoiceDesignGender = z.infer<typeof VoiceDesignGender>

export const DesignVoiceRequest = z
  .object({
    description: z.string().trim().min(1).max(1000),
    gender: VoiceDesignGender,
    displayName: z.string().trim().min(1).max(80),
    languageCode: z.literal('ja-JP').default('ja-JP'),
  })
  .strict()
export type DesignVoiceRequest = z.input<typeof DesignVoiceRequest>

export type DesignVoiceResult = {
  readonly voiceId: string
  /** 試し聞き（WAV）。返らなければ null。 */
  readonly sampleWav: Buffer | null
}

const DesignResponse = z
  .object({
    id: z.string(),
    sample_audio: z.object({ data: z.string().optional() }).passthrough().optional(),
  })
  .passthrough()

export type GeminiVoiceDesigner = {
  readonly designVoice: (request: DesignVoiceRequest, signal?: AbortSignal) => Promise<DesignVoiceResult>
}

export const createGeminiVoiceDesigner = (deps: GeminiRequestDeps): GeminiVoiceDesigner => ({
  designVoice: async (request, signal) => {
    const input = DesignVoiceRequest.parse(request)
    const body = {
      store: true,
      voice: {
        model: GEMINI_DEFAULT_TTS_MODEL,
        type: 'prompted',
        display_name: input.displayName,
        gender: input.gender,
        language_code: input.languageCode,
        prompted: { input: input.description },
      },
    }
    const response = await geminiPostJson(deps, GEMINI_VOICES_URL, body, DesignResponse, signal)
    if (!response.id.startsWith('voice_')) {
      throw new VoiceProviderError('bad_response', 'Gemini が声の ID を返しませんでした。AI の仕様が変わった可能性があります', false)
    }
    const sample = response.sample_audio?.data
    return { voiceId: response.id, sampleWav: sample === undefined || sample === '' ? null : Buffer.from(sample, 'base64') }
  },
})
