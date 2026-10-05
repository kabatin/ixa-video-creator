import { z } from 'zod'
import { canonicalJson } from '../generation/spec.js'
import type { NarrationLine } from './narration-line.js'
import { VoiceToolId, VoiceTuning, type VoiceProfile } from './voice-profile.js'

/**
 * 声の生成の指定（ADR-0038）。声の AI に渡すものだけを持つ。**同じ指定なら同じ声**とみなし、
 * 作り直さずに前の Take を使う（Gemini の無料枠 1 日 100 回の対策にもなる）。
 *
 * 表示・声の呼び名・音量は含めない（読み上げの中身が変わらないため）。
 */

export const VoiceSpec = z.object({
  tool: VoiceToolId,
  model: z.string().nullable(),
  voiceName: z.string(),
  language: z.string(),
  styleNote: z.string(),
  /** 行の演出。 */
  direction: z.string(),
  speed: z.number(),
  tuning: VoiceTuning,
  /** 読ませる字。 */
  reading: z.string(),
})
export type VoiceSpec = z.infer<typeof VoiceSpec>

export const voiceSpecOf = (
  voice: Pick<VoiceProfile, 'tool' | 'model' | 'voiceName' | 'language' | 'styleNote' | 'speed' | 'tuning'>,
  line: Pick<NarrationLine, 'direction'>,
  reading: string,
): VoiceSpec => ({
  tool: voice.tool,
  model: voice.model,
  voiceName: voice.voiceName,
  language: voice.language,
  styleNote: voice.styleNote,
  direction: line.direction,
  speed: voice.speed,
  tuning: voice.tuning,
  reading,
})

/** 指定のハッシュ（SHA-256）。キーの順に依存しない。 */
export const voiceSpecHash = async (spec: VoiceSpec): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalJson(spec))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
