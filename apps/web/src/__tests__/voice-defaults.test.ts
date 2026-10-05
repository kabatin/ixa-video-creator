import { describe, expect, it } from 'vitest'
import { VOICE_TOOL_LABELS, newVoiceDefaults } from '@/lib/voice-defaults'
import { parseFadeInput } from '@/lib/time-input'

/** 声を名前だけで作るときの既定（ADR-0038）。「使う AI」の声の AI と、その AI の最初の声。 */

const options = (voices: readonly string[], models: readonly string[] = []) => ({
  models: models.map((id) => ({ id, label: id })),
  voices: voices.map((id) => ({ id, label: id, note: null })),
})

describe('newVoiceDefaults', () => {
  it('「使う AI」の声の AI と、その一覧の最初の声・モデルにする', () => {
    expect(newVoiceDefaults('gemini_api', options(['Kore', 'Puck'], ['gemini-3.8-flash-tts']))).toEqual({
      tool: 'gemini_api',
      voiceName: 'Kore',
      model: 'gemini-3.8-flash-tts',
    })
    expect(newVoiceDefaults('macos_say', options(['Kyoko']))).toEqual({ tool: 'macos_say', voiceName: 'Kyoko', model: null })
  })

  it('声に使えない AI が選ばれている・一覧が取れない・声が 0 件なら、お試しの声にする（作れないより、作って直せる方がよい）', () => {
    expect(newVoiceDefaults('claude_cli', options(['x']))).toEqual({ tool: 'stub', voiceName: 'stub', model: null })
    expect(newVoiceDefaults('gemini_api', null)).toEqual({ tool: 'stub', voiceName: 'stub', model: null })
    expect(newVoiceDefaults('elevenlabs', options([]))).toEqual({ tool: 'stub', voiceName: 'stub', model: null })
  })

  it('声の AI の名前は画面の言葉（内部の名前を出さない）', () => {
    expect(VOICE_TOOL_LABELS).toEqual({ stub: 'お試しの声', macos_say: 'Mac の声', gemini_api: 'Gemini', elevenlabs: 'ElevenLabs' })
  })
})

describe('parseFadeInput', () => {
  it('空・0 はフェードなし（0）。秒で入れる（s は付けても付けなくても）', () => {
    expect(parseFadeInput('')).toBe(0)
    expect(parseFadeInput('0')).toBe(0)
    expect(parseFadeInput('0.00s')).toBe(0)
    expect(parseFadeInput('2.5s')).toBe(2.5)
    expect(parseFadeInput('3')).toBe(3)
  })

  it('読めない値と負の値は null', () => {
    expect(parseFadeInput('abc')).toBeNull()
    expect(parseFadeInput('-1')).toBeNull()
  })
})
