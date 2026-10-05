import { describe, expect, it } from 'vitest'
import { createTranscribers, createVoiceAdapters } from '../adapters.js'
import { createFetch, jsonResponse } from './fake-fetch.js'

/**
 * 声と文字起こしの AI の表（ADR-0038）。API（声の一覧）と worker（声にする）で同じ表を使う。
 * **鍵があっても、使ってよいと明示していない外部 API の口は作らない**（`AUDIO_API_PROVIDERS`）。
 */

const runCli = () => Promise.resolve({ kind: 'completed' as const, exitCode: 0, stdout: '', stderr: '' })
const { fetch } = createFetch(() => jsonResponse({}))
const base = {
  runCli,
  fetch,
  convertForWhisper: () => Promise.resolve(),
  gemini: { apiKey: 'g-key', enabled: false, ttsCostOf: () => 0, transcribeCostOf: () => 0 },
  elevenLabs: { apiKey: 'e-key', enabled: false, ttsCostOf: () => 0, transcribeCostOf: () => 0 },
  whisperCppModel: null,
}

describe('createVoiceAdapters', () => {
  it('お試しと Mac の声はいつも口がある。外部 API は使ってよいと明示したときだけ', () => {
    const adapters = createVoiceAdapters(base)
    expect(adapters('stub')?.tool).toBe('stub')
    expect(adapters('macos_say')?.tool).toBe('macos_say')
    expect(adapters('gemini_api')).toBeNull()
    expect(adapters('elevenlabs')).toBeNull()

    const enabled = createVoiceAdapters({ ...base, gemini: { ...base.gemini, enabled: true }, elevenLabs: { ...base.elevenLabs, enabled: true } })
    expect(enabled('gemini_api')?.tool).toBe('gemini_api')
    expect(enabled('elevenlabs')?.tool).toBe('elevenlabs')
  })

  it('鍵が無ければ、明示していても口を作らない', () => {
    const adapters = createVoiceAdapters({ ...base, gemini: { ...base.gemini, apiKey: null, enabled: true } })
    expect(adapters('gemini_api')).toBeNull()
  })
})

describe('createTranscribers', () => {
  it('whisper.cpp はモデルのファイルがあるときだけ。外部 API は明示したときだけ', () => {
    expect(createTranscribers(base)('whisper_cpp')).toBeNull()
    expect(createTranscribers({ ...base, whisperCppModel: '/m/ggml.bin' })('whisper_cpp')?.tool).toBe('whisper_cpp')
    expect(createTranscribers(base)('stub')?.tool).toBe('stub')
    expect(createTranscribers(base)('elevenlabs')).toBeNull()
    expect(createTranscribers({ ...base, elevenLabs: { ...base.elevenLabs, enabled: true } })('elevenlabs')?.tool).toBe('elevenlabs')
  })
})
