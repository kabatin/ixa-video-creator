import { describe, expect, it } from 'vitest'
import { voiceFailureFromStatus } from '../voice.js'

/** 声・文字起こしの AI の失敗（ADR-0038）。画面にそのまま出せる文にし、やり直せるかを分ける。 */
describe('voiceFailureFromStatus', () => {
  it('429 は回数の上限（時間を置けばやり直せる）', () => {
    expect(voiceFailureFromStatus('Gemini', 429)).toMatchObject({ code: 'rate_limited', retryable: true })
    expect(voiceFailureFromStatus('Gemini', 429).message).toMatch(/Gemini の回数の上限/)
  })

  it('401・403 は鍵の問題（やり直しても直らない）', () => {
    expect(voiceFailureFromStatus('ElevenLabs', 401)).toMatchObject({ code: 'auth', retryable: false })
    expect(voiceFailureFromStatus('ElevenLabs', 403).message).toMatch(/\.env の鍵/)
  })

  it('500 台は向こうの不調（やり直せる）、ほかは要求の問題', () => {
    expect(voiceFailureFromStatus('Gemini', 503)).toMatchObject({ code: 'unavailable', retryable: true })
    expect(voiceFailureFromStatus('Gemini', 400)).toMatchObject({ code: 'bad_request', retryable: false })
  })
})
