import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFetch, jsonResponse as json, sentJson } from './fake-fetch.js'
import { ELEVENLABS_MODELS, createElevenLabsTranscriber, createElevenLabsVoice } from '../elevenlabs.js'

/**
 * ElevenLabs の声と文字起こし（ADR-0038）。**実 API は叩かない**（偽の fetch で）。
 * 形は 2026-10-05 の公式の説明（`/v1/text-to-speech/{voice_id}/with-timestamps`・`/v1/speech-to-text`）。鍵は `xi-api-key` だけ。
 */

const KEY = 'eleven-secret-key-0123456789'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'voice-eleven-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const MP3 = Buffer.from('mp3-bytes')

const speakResponse = (alignment: unknown) => json({ audio_base64: MP3.toString('base64'), alignment, normalized_alignment: null })

const request = (patch = {}) => ({
  text: 'はい。',
  model: 'eleven_v4',
  voiceName: 'voice-123',
  styleNote: '落ち着いた声',
  direction: '',
  speed: 1.5,
  tuning: { stability: 0.4, similarity: 0.8, style: 0.2 },
  language: 'ja',
  outputBasePath: join(dir, 'line'),
  ...patch,
})

describe('createElevenLabsVoice', () => {
  it('時刻つきの口に、読み・モデル・調整（速さは 0.7〜1.2 に収める）を送る。鍵は xi-api-key だけ', async () => {
    const { calls, fetch } = createFetch(() => speakResponse(null))
    const voice = createElevenLabsVoice({ apiKey: KEY, fetch, costOf: () => 0 })

    await voice.speak(request())

    expect(calls[0]?.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-123/with-timestamps?output_format=mp3_44100_128')
    expect(calls[0]?.headers.get('xi-api-key')).toBe(KEY)
    expect(sentJson(calls[0])).toEqual({
      text: 'はい。',
      model_id: 'eleven_v4',
      language_code: 'ja',
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.2, speed: 1.2 },
    })
  })

  it('multilingual_v2 には言語を送らない（受け付けない）。モデルが無ければ multilingual_v2', async () => {
    const { calls, fetch } = createFetch(() => speakResponse(null))
    const voice = createElevenLabsVoice({ apiKey: KEY, fetch, costOf: () => 0 })

    await voice.speak(request({ model: null, tuning: {}, speed: 1 }))

    expect(sentJson(calls[0])).toEqual({
      text: 'はい。',
      model_id: 'eleven_multilingual_v2',
      voice_settings: { speed: 1 },
    })
  })

  it('音を MP3 で書き、送った字の時刻と、字数からの費用を返す', async () => {
    const costOf = vi.fn(() => 0.00024)
    const voice = createElevenLabsVoice({
      apiKey: KEY,
      fetch: () =>
        Promise.resolve(
          speakResponse({ characters: ['は', 'い', '。'], character_start_times_seconds: [0, 0.2, 0.4], character_end_times_seconds: [0.2, 0.4, 0.5] }),
        ),
      costOf,
    })

    const result = await voice.speak(request())

    expect(result.audioPath).toBe(join(dir, 'line.mp3'))
    expect(await readFile(result.audioPath)).toEqual(MP3)
    expect(result.charTimes).toEqual([
      { char: 'は', startSec: 0, endSec: 0.2 },
      { char: 'い', startSec: 0.2, endSec: 0.4 },
      { char: '。', startSec: 0.4, endSec: 0.5 },
    ])
    expect(costOf).toHaveBeenCalledWith(3)
    expect(result.costUsd).toBe(0.00024)
  })

  it('時刻の並びの長さが合わなければ、時刻は無いものとする（ずれた時刻で字幕を出さない）', async () => {
    const voice = createElevenLabsVoice({
      apiKey: KEY,
      fetch: () =>
        Promise.resolve(speakResponse({ characters: ['は'], character_start_times_seconds: [0, 1], character_end_times_seconds: [1] })),
      costOf: () => 0,
    })
    expect((await voice.speak(request())).charTimes).toBeNull()
  })

  it('声の一覧は /v1/voices から（特徴は labels）', async () => {
    const { calls, fetch } = createFetch(() =>
      json({ voices: [{ voice_id: 'v1', name: 'Hana', labels: { gender: 'female', age: 'young' } }] }),
    )
    const voices = await createElevenLabsVoice({ apiKey: KEY, fetch, costOf: () => 0 }).listVoices('ja')

    expect(calls[0]?.url).toBe('https://api.elevenlabs.io/v1/voices')
    expect(voices).toEqual([{ id: 'v1', label: 'Hana', note: 'female・young' }])
    expect(ELEVENLABS_MODELS.map((m) => m.id)).toEqual(['eleven_v4', 'eleven_multilingual_v2', 'eleven_flash_v2_5'])
  })
})

describe('createElevenLabsTranscriber', () => {
  it('Scribe に音を送り（字の時刻を頼む）、語の中の字の時刻を返す。音の出来事（笑い声など）は字にしない', async () => {
    const audioPath = join(dir, 'rec.m4a')
    await writeFile(audioPath, Buffer.from('m4a'))
    const { calls, fetch } = createFetch(() =>
        json({
          language_code: 'ja',
          text: 'はい そう',
          words: [
            { text: 'はい', start: 0, end: 0.4, type: 'word', characters: [{ text: 'は', start: 0, end: 0.2 }, { text: 'い', start: 0.2, end: 0.4 }] },
            { text: ' ', start: 0.4, end: 0.5, type: 'spacing' },
            { text: '(笑)', start: 0.5, end: 0.9, type: 'audio_event' },
            { text: 'そう', start: 1, end: 1.4, type: 'word' },
          ],
        }),
    )
    const transcriber = createElevenLabsTranscriber({ apiKey: KEY, fetch, costOf: (sec) => sec / 100 })

    const result = await transcriber.transcribe({ audioPath, language: 'ja', keyterms: ['戦子'], workDir: dir, durationSec: 10 })

    expect(calls[0]?.url).toBe('https://api.elevenlabs.io/v1/speech-to-text')
    expect(calls[0]?.headers.get('xi-api-key')).toBe(KEY)
    const form = calls[0]?.form ?? new FormData()
    expect(form.get('model_id')).toBe('scribe_v2')
    expect(form.get('language_code')).toBe('ja')
    expect(form.get('timestamps_granularity')).toBe('character')
    expect(form.getAll('keyterms')).toEqual(['戦子'])
    expect(form.get('file')).toBeInstanceOf(Blob)

    expect(result.text).toBe('はい そう')
    expect(result.chars?.map((c) => c.char).join('')).toBe('はい そう')
    expect(result.chars?.[0]).toEqual({ char: 'は', startSec: 0, endSec: 0.2 })
    expect(result.chars?.[3]?.startSec).toBe(1)
    expect(result.segments).toEqual([
      { text: 'はい', startSec: 0, endSec: 0.4 },
      { text: ' ', startSec: 0.4, endSec: 0.5 },
      { text: 'そう', startSec: 1, endSec: 1.4 },
    ])
    expect(result.costUsd).toBeCloseTo(0.1)
  })
})
