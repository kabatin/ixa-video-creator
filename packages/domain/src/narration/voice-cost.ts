/**
 * 声・文字起こしの費用の見積もり（ADR-0038）。頼む前に予算を確かめるのに使う。実際の額はジョブが終わってから保存する。
 *
 * 料金は 2026-10-05 時点の公開値。
 * - Gemini 3.8 Flash TTS: 音の出力 100 万トークンで $9（2027-01-01 から $18）。Flash-Lite は $6（→ $12）。音 1 秒 = 25 トークン
 * - ElevenLabs: 字数 × 単価（プランで違うので env で渡す。従量課金は 1000 字 $0.08）
 * - ElevenLabs Scribe: 1 時間 $0.22。Gemini 3.5 Transcribe: 1 分 $0.005
 */

export const GEMINI_TTS_TOKENS_PER_SEC = 25
const GEMINI_PRICE_DOUBLES_AT = Date.parse('2027-01-01T00:00:00Z')
const SCRIBE_USD_PER_HOUR = 0.22
const GEMINI_TRANSCRIBE_USD_PER_MIN = 0.005

/** Gemini の声の出力の単価（100 万トークンあたり）。 */
export const geminiTtsUsdPerMillionTokens = (model: string | null, at: Date): number => {
  const base = model?.includes('flash-lite') === true ? 6 : 9
  return at.getTime() >= GEMINI_PRICE_DOUBLES_AT ? base * 2 : base
}

export type SpeakCostInput = {
  readonly tool: string
  readonly model: string | null
  /** 読ませる字数。 */
  readonly readingChars: number
  /** 話す長さの見積もり（秒）。 */
  readonly estimatedSec: number
  readonly at: Date
  readonly elevenLabsUsdPer1kChars: number
  /** Gemini を無料枠で使っているか（無料枠は 0）。 */
  readonly geminiBilling: 'free' | 'paid'
}

export const estimateSpeakCostUsd = (input: SpeakCostInput): number => {
  switch (input.tool) {
    case 'gemini_api':
      return input.geminiBilling === 'free'
        ? 0
        : (input.estimatedSec * GEMINI_TTS_TOKENS_PER_SEC * geminiTtsUsdPerMillionTokens(input.model, input.at)) / 1_000_000
    case 'elevenlabs':
      return (input.readingChars / 1000) * input.elevenLabsUsdPer1kChars
    default:
      return 0
  }
}

export const estimateTranscribeCostUsd = (input: { readonly tool: string; readonly durationSec: number }): number => {
  switch (input.tool) {
    case 'elevenlabs':
      return (input.durationSec / 3600) * SCRIBE_USD_PER_HOUR
    case 'gemini_api':
      return (input.durationSec / 60) * GEMINI_TRANSCRIBE_USD_PER_MIN
    default:
      return 0
  }
}
