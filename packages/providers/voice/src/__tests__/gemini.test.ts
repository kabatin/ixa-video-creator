import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VoiceProviderError } from '@ixa/provider-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFetch, jsonResponse as json, sentJson } from './fake-fetch.js'
import { GEMINI_TTS_MODELS, GEMINI_VOICES, createGeminiTranscriber, createGeminiVoice, geminiStyleOf } from '../gemini.js'

/**
 * Gemini の声と文字起こし（ADR-0038）。**実 API は叩かない**（偽の fetch で、送る形と受け取る形を確かめる）。
 * 形は 2026-10-05 の公式の説明（generateContent・`speech_metadata.style`・`voiceConfig.voice`、
 * 文字起こしは `audioTranscriptionConfig.wordTimestamp`）。鍵はヘッダーだけ。
 */

const KEY = 'gemini-secret-key-0123456789'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'voice-gemini-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const audioResponse = (mimeType: string, bytes: Buffer, tokens = 250) =>
  json({
    candidates: [{ content: { parts: [{ inlineData: { mimeType, data: bytes.toString('base64') } }] } }],
    usageMetadata: { candidatesTokenCount: tokens },
  })

const request = (patch = {}) => ({
  text: 'すすめ、せんこちゃん。',
  model: 'gemini-3.8-flash-tts',
  voiceName: 'Kore',
  styleNote: '落ち着いた低めの声',
  direction: '囁くように',
  speed: 1,
  tuning: {},
  language: 'ja',
  outputBasePath: join(dir, 'line'),
  ...patch,
})

describe('geminiStyleOf', () => {
  it('声のイメージ・演出・速さを 1 つの読み方の指示にする（空のものは入れない）', () => {
    expect(geminiStyleOf('低めの声', '囁くように', 1)).toBe('低めの声。囁くように')
    expect(geminiStyleOf('', '', 0.8)).toBe('ゆっくり話す')
    expect(geminiStyleOf('', '', 1.1)).toBe('少し速めに話す')
    expect(geminiStyleOf('', '', 1)).toBe('')
  })
})

describe('createGeminiVoice', () => {
  it('generateContent に、読みと読み方の指示（speech_metadata.style）と声を送る。鍵はヘッダーだけ', async () => {
    const { calls, fetch } = createFetch(() => audioResponse('audio/wav', Buffer.from('RIFF....WAVE')))
    const voice = createGeminiVoice({ apiKey: KEY, fetch, costOf: () => 0 })

    await voice.speak(request())

    expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent')
    expect(calls[0]?.url).not.toContain(KEY)
    expect(calls[0]?.headers.get('x-goog-api-key')).toBe(KEY)
    expect(sentJson(calls[0])).toEqual({
      contents: [
        { role: 'user', parts: [{ text: 'すすめ、せんこちゃん。', speech_metadata: { style: '落ち着いた低めの声。囁くように' } }] },
      ],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: 'Kore' } } },
    })
  })

  it('読み方の指示が無ければ speech_metadata を付けない。モデルが無ければ Flash TTS', async () => {
    const { calls, fetch } = createFetch(() => audioResponse('audio/wav', Buffer.from('x')))
    const voice = createGeminiVoice({ apiKey: KEY, fetch, costOf: () => 0 })

    await voice.speak(request({ model: null, styleNote: '', direction: '' }))

    expect(calls[0]?.url).toContain('/models/gemini-3.8-flash-tts:generateContent')
    expect(sentJson(calls[0])).toMatchObject({ contents: [{ parts: [{ text: 'すすめ、せんこちゃん。' }] }] })
    expect(JSON.stringify(sentJson(calls[0]))).not.toContain('speech_metadata')
  })

  it('WAV はそのまま書き、費用は出力のトークン数から（字の時刻は返さない）', async () => {
    const wav = Buffer.from('RIFF-wav-bytes')
    const costOf = vi.fn(() => 0.00225)
    const voice = createGeminiVoice({ apiKey: KEY, fetch: () => Promise.resolve(audioResponse('audio/wav', wav, 250)), costOf })

    const result = await voice.speak(request())

    expect(result.audioPath).toBe(join(dir, 'line.wav'))
    expect(await readFile(result.audioPath)).toEqual(wav)
    expect(costOf).toHaveBeenCalledWith({ model: 'gemini-3.8-flash-tts', outputTokens: 250 })
    expect(result.costUsd).toBe(0.00225)
    expect(result.charTimes).toBeNull()
    expect(JSON.stringify(result.record)).not.toContain(KEY)
  })

  it('頭の無い PCM（audio/L16）は WAV に包む', async () => {
    const voice = createGeminiVoice({
      apiKey: KEY,
      fetch: () => Promise.resolve(audioResponse('audio/L16;codec=pcm;rate=24000', Buffer.from([1, 0, 2, 0]))),
      costOf: () => 0,
    })

    const written = await readFile((await voice.speak(request())).audioPath)

    expect(written.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(written.readUInt32LE(24)).toBe(24000)
  })

  it('上限（429）は「回数の上限」の失敗にする（鍵を文に入れない）', async () => {
    const voice = createGeminiVoice({ apiKey: KEY, fetch: () => Promise.resolve(json({ error: { message: KEY } }, 429)), costOf: () => 0 })

    const error = await voice.speak(request()).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(VoiceProviderError)
    expect((error as VoiceProviderError).code).toBe('rate_limited')
    expect((error as Error).message).not.toContain(KEY)
  })

  it('音が入っていない応答は、形が違うと大きく失敗する', async () => {
    const voice = createGeminiVoice({ apiKey: KEY, fetch: () => Promise.resolve(json({ candidates: [] })), costOf: () => 0 })
    await expect(voice.speak(request())).rejects.toMatchObject({ code: 'bad_response' })
  })

  it('声は 30 種類、モデルは Flash と Flash-Lite', async () => {
    expect(GEMINI_VOICES).toHaveLength(30)
    const { fetch } = createFetch(() => json({}))
    expect((await createGeminiVoice({ apiKey: KEY, fetch, costOf: () => 0 }).listVoices('ja')).find((v) => v.id === 'Kore')).toEqual({
      id: 'Kore',
      label: 'Kore',
      note: '芯がある',
    })
    expect(GEMINI_TTS_MODELS.map((m) => m.id)).toEqual(['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'])
  })
})

describe('createGeminiTranscriber', () => {
  it('音を base64 で送り、語の時刻を頼む（gemini-3.5-transcribe）。語の時刻を字に割り振る', async () => {
    const audioPath = join(dir, 'rec.mp3')
    await writeFile(audioPath, Buffer.from('mp3-bytes'))
    const { calls, fetch } = createFetch(() =>
        json({
          candidates: [
            {
              audioTranscription: {
                words: [
                  { word: 'こんにちは', startOffset: '0.100s', endOffset: '0.600s' },
                  { word: '世界', startOffset: '0.700s', endOffset: '1.100s' },
                ],
              },
            },
          ],
        }),
    )
    const transcriber = createGeminiTranscriber({ apiKey: KEY, fetch, costOf: (sec) => sec * 0.001 })

    const result = await transcriber.transcribe({ audioPath, language: 'ja', keyterms: [], workDir: dir, durationSec: 60 })

    expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent')
    expect(calls[0]?.headers.get('x-goog-api-key')).toBe(KEY)
    expect(sentJson(calls[0])).toEqual({
      contents: [{ parts: [{ inlineData: { mimeType: 'audio/mpeg', data: Buffer.from('mp3-bytes').toString('base64') } }] }],
      generationConfig: { audioTranscriptionConfig: { wordTimestamp: true } },
    })

    expect(result.text).toBe('こんにちは世界')
    expect(result.segments).toEqual([
      { text: 'こんにちは', startSec: 0.1, endSec: 0.6 },
      { text: '世界', startSec: 0.7, endSec: 1.1 },
    ])
    expect(result.chars?.map((c) => c.char).join('')).toBe('こんにちは世界')
    expect(result.chars?.[5]?.startSec).toBeCloseTo(0.7)
    expect(result.costUsd).toBeCloseTo(0.06)
  })

  it('語の時刻が無い応答は、形が違うと大きく失敗する', async () => {
    const audioPath = join(dir, 'rec.wav')
    await writeFile(audioPath, Buffer.from('x'))
    const transcriber = createGeminiTranscriber({
      apiKey: KEY,
      fetch: () => Promise.resolve(json({ candidates: [{ content: { parts: [{ text: 'こんにちは' }] } }] })),
      costOf: () => 0,
    })
    await expect(
      transcriber.transcribe({ audioPath, language: 'ja', keyterms: [], workDir: dir, durationSec: 1 }),
    ).rejects.toMatchObject({ code: 'bad_response' })
  })
})
