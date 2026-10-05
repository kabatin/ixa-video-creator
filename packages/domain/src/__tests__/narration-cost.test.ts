import { describe, expect, it } from 'vitest'
import { estimateSpeakCostUsd, estimateTranscribeCostUsd, geminiTtsUsdPerMillionTokens, voiceCostRules } from '../narration/voice-cost.js'

/**
 * 声・文字起こしの費用の見積もり（ADR-0038）。頼む前に予算を確かめるのに使う。
 * 料金は 2026-10-05 時点の公開値（Gemini は 2027-01-01 から音の出力が倍）。
 */

const BEFORE_2027 = new Date('2026-12-31T23:59:59Z')
const FROM_2027 = new Date('2027-01-01T00:00:00Z')

describe('geminiTtsUsdPerMillionTokens', () => {
  it('Flash は 2026 年中 $9、2027-01-01 から $18。Flash-Lite は $6 → $12', () => {
    expect(geminiTtsUsdPerMillionTokens('gemini-3.8-flash-tts', BEFORE_2027)).toBe(9)
    expect(geminiTtsUsdPerMillionTokens('gemini-3.8-flash-tts', FROM_2027)).toBe(18)
    expect(geminiTtsUsdPerMillionTokens('gemini-3.8-flash-lite-tts', BEFORE_2027)).toBe(6)
    expect(geminiTtsUsdPerMillionTokens('gemini-3.8-flash-lite-tts', FROM_2027)).toBe(12)
  })
})

describe('estimateSpeakCostUsd', () => {
  const base = { readingChars: 100, estimatedSec: 10, at: BEFORE_2027, elevenLabsUsdPer1kChars: 0.08, geminiBilling: 'paid' as const }

  it('Gemini（有料）: 音 1 秒 25 トークンで見積もる（10 秒で $0.00225、2027 年から倍）', () => {
    expect(estimateSpeakCostUsd({ ...base, tool: 'gemini_api', model: 'gemini-3.8-flash-tts' })).toBeCloseTo(0.00225, 6)
    expect(estimateSpeakCostUsd({ ...base, tool: 'gemini_api', model: 'gemini-3.8-flash-tts', at: FROM_2027 })).toBeCloseTo(0.0045, 6)
  })

  it('Gemini の無料枠なら 0', () => {
    expect(estimateSpeakCostUsd({ ...base, tool: 'gemini_api', model: 'gemini-3.8-flash-tts', geminiBilling: 'free' })).toBe(0)
  })

  it('ElevenLabs: 字数 × 単価（100 字・$0.08/1000 字で $0.008）', () => {
    expect(estimateSpeakCostUsd({ ...base, tool: 'elevenlabs', model: 'eleven_v4' })).toBeCloseTo(0.008, 6)
  })

  it('Mac の声とスタブは 0', () => {
    expect(estimateSpeakCostUsd({ ...base, tool: 'macos_say', model: null })).toBe(0)
    expect(estimateSpeakCostUsd({ ...base, tool: 'stub', model: null })).toBe(0)
  })
})

describe('estimateTranscribeCostUsd', () => {
  it('ElevenLabs Scribe は 1 時間 $0.22、Gemini Transcribe は 1 分 $0.005、whisper.cpp とスタブは 0', () => {
    expect(estimateTranscribeCostUsd({ tool: 'elevenlabs', durationSec: 3600 })).toBeCloseTo(0.22, 6)
    expect(estimateTranscribeCostUsd({ tool: 'gemini_api', durationSec: 60 })).toBeCloseTo(0.005, 6)
    expect(estimateTranscribeCostUsd({ tool: 'whisper_cpp', durationSec: 3600 })).toBe(0)
    expect(estimateTranscribeCostUsd({ tool: 'stub', durationSec: 3600 })).toBe(0)
  })
})

describe('voiceCostRules', () => {
  /** 実際に使った量から額を出す（API の見積もりと worker の記録で同じ規則を使う）。 */
  it('Gemini は出力のトークン数 × 単価（無料枠なら 0）、ElevenLabs は字数 × 単価、文字起こしは長さから', () => {
    const paid = voiceCostRules({ geminiBilling: 'paid', elevenLabsUsdPer1kChars: 0.08, now: () => BEFORE_2027 })
    expect(paid.geminiTts({ model: 'gemini-3.8-flash-tts', outputTokens: 1_000_000 })).toBe(9)
    expect(paid.elevenLabsTts(1000)).toBeCloseTo(0.08)
    expect(paid.transcribe('elevenlabs', 3600)).toBeCloseTo(0.22)
    const free = voiceCostRules({ geminiBilling: 'free', elevenLabsUsdPer1kChars: 0.08, now: () => FROM_2027 })
    expect(free.geminiTts({ model: 'gemini-3.8-flash-tts', outputTokens: 1_000_000 })).toBe(0)
  })
})
