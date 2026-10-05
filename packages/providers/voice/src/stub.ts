import { writeFile } from 'node:fs/promises'
import type { CharTime } from '@ixa/domain'
import type { SpeakRequest, SpeakResult, Transcriber, TranscribeRequest, TranscribeResult, VoiceAdapter } from '@ixa/provider-core'
import { pcm16Wav } from './wav.js'

/**
 * お試しの声と文字起こし（ADR-0038）。AI を使わず、外にも出さない。
 * 字ごとに時刻を付けるので、話している字を強調する字幕の流れも無料で確かめられる。
 */

/** 1 字の長さ（秒）。 */
export const STUB_CHAR_SEC = 0.15
const MIN_SEC = 0.5
const RATE = 24000
const TONE_HZ = 330
/** 小さめの音（最大の 1 割）。 */
const AMPLITUDE = 0.1 * 32767

/** 字ごとに短く鳴る音（字の境目で一瞬切る）。間や長さを耳で確かめられる。 */
const toneFor = (charCount: number, seconds: number): Int16Array => {
  const total = Math.round(seconds * RATE)
  const perChar = charCount === 0 ? total : Math.floor(total / charCount)
  const gap = Math.round(0.02 * RATE)
  return Int16Array.from({ length: total }, (_, i) => {
    const within = perChar === 0 ? 0 : i % perChar
    if (within >= perChar - gap) return 0
    return Math.round(AMPLITUDE * Math.sin((2 * Math.PI * TONE_HZ * i) / RATE))
  })
}

const speak = async (request: SpeakRequest): Promise<SpeakResult> => {
  const chars = [...request.text]
  const seconds = Math.max(MIN_SEC, (chars.length * STUB_CHAR_SEC) / request.speed)
  const step = chars.length === 0 ? 0 : seconds / chars.length
  const audioPath = `${request.outputBasePath}.wav`
  await writeFile(audioPath, pcm16Wav(toneFor(chars.length, seconds), RATE))
  const charTimes: CharTime[] = chars.map((char, index) => ({ char, startSec: index * step, endSec: (index + 1) * step }))
  return { audioPath, charTimes, costUsd: 0, record: { tool: 'stub', seconds } }
}

export const createStubVoice = (): VoiceAdapter => ({
  tool: 'stub',
  models: [],
  listVoices: () => Promise.resolve([{ id: 'stub', label: 'お試しの声', note: null }]),
  speak,
})

const STUB_TEXT = 'お試しの文字起こしです。'
const STUB_MAX_SEC = 3

export const createStubTranscriber = (): Transcriber => ({
  tool: 'stub',
  transcribe: (request: TranscribeRequest): Promise<TranscribeResult> => {
    const endSec = Math.min(STUB_MAX_SEC, request.durationSec)
    return Promise.resolve({
      text: STUB_TEXT,
      chars: null,
      segments: [{ text: STUB_TEXT, startSec: 0, endSec }],
      costUsd: 0,
      record: { tool: 'stub' },
    })
  },
})
