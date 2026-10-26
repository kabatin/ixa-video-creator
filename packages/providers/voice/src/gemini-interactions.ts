import { z } from 'zod'

/**
 * 作った声（Voice Design の `voice_…`）を読ませる口の形（ADR-0062）。**この 1 ファイルだけが形を知る。**
 * 形は AnimalVideo（tools/dub/gemini.py。実際に動いている）から写した（2026-10-26）。
 *
 * - 要求: `POST v1beta/interactions`。読み方の指示は `annotations` の `speech_metadata`（無ければ鍵ごと省く）
 * - 応答: `steps[]` のうち `model_output` の `content[]` の `audio` の、**最後の 1 つ**の `data`（base64 の WAV）
 *
 * 既製の声（Kore など）は今まで通り `generateContent` で読む（ナレーションは変えない）。
 */

export const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'

/** 作った声の ID か（Voice Design は `voice_` で始まる ID を返す）。 */
export const isDesignedVoice = (voiceName: string): boolean => voiceName.startsWith('voice_')

export const interactionsBody = (input: { readonly model: string; readonly text: string; readonly style: string; readonly voice: string }) => ({
  model: input.model,
  input: [
    {
      type: 'user_input',
      content: [
        {
          type: 'text',
          text: input.text,
          ...(input.style === '' ? {} : { annotations: [{ type: 'speech_metadata', style: input.style }] }),
        },
      ],
    },
  ],
  response_format: { type: 'audio' },
  generation_config: { speech_config: [{ voice: input.voice }] },
})

const ContentItem = z.object({ type: z.string(), data: z.string().optional() }).passthrough()
const Step = z.object({ type: z.string(), content: z.array(ContentItem).optional() }).passthrough()
export const InteractionsResponse = z.object({ steps: z.array(Step) }).passthrough()
export type InteractionsResponse = z.infer<typeof InteractionsResponse>

/** 返った音（base64）。無ければ null。 */
export const interactionsAudioOf = (response: InteractionsResponse): string | null => {
  const audio = response.steps
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .filter((item) => item.type === 'audio' && item.data !== undefined && item.data !== '')
  return audio[audio.length - 1]?.data ?? null
}
