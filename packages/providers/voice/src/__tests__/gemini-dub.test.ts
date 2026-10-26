import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VoiceProviderError } from '@ixa/provider-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFetch, jsonResponse as json, sentJson } from './fake-fetch.js'
import { createGeminiVoice } from '../gemini.js'
import { createGeminiVoiceDesigner } from '../gemini-voice-design.js'
import { parseRetryDelaySec } from '../gemini-request.js'
import type { FetchLike } from '../http.js'
import { pcm16Wav } from '../wav.js'

/**
 * Gemini の待って送り直す・作った声で読む・声を説明から作る（ADR-0062）。**実 API は叩かない**（偽の fetch）。
 * 作った声と Voice Design の形は AnimalVideo（tools/dub/gemini.py。実際に動いている）から写した。
 */

const KEY = 'gemini-secret-key-0123456789'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'voice-gemini-dub-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const request = (patch = {}) => ({
  text: 'ねえ、ネズミくん。',
  model: 'gemini-3.8-flash-tts',
  voiceName: 'Kore',
  styleNote: '',
  direction: 'からかうように',
  speed: 1,
  tuning: {},
  language: 'ja',
  outputBasePath: join(dir, 'line'),
  ...patch,
})

const audioResponse = () =>
  json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: Buffer.from('RIFF').toString('base64') } }] } }] })

const text = (body: string, status: number): Response => new Response(body, { status })

/** 返す応答を順に並べた偽の fetch と、待った長さの控え。 */
const sequence = (responses: readonly (() => Response)[]) => {
  const waits: number[] = []
  let index = 0
  const fake = createFetch(() => {
    const next = responses[Math.min(index, responses.length - 1)]
    index += 1
    if (next === undefined) throw new Error('no response')
    return next()
  })
  const sleep = (ms: number): Promise<void> => {
    waits.push(ms)
    return Promise.resolve()
  }
  return { ...fake, waits, sleep }
}

const voiceWith = (
  fake: { readonly fetch: FetchLike; readonly sleep: (ms: number) => Promise<void> },
  costOf: (usage: { readonly model: string; readonly outputTokens: number }) => number = () => 0,
) =>
  createGeminiVoice({ apiKey: KEY, fetch: fake.fetch, sleep: fake.sleep, costOf })

const failure = async (promise: Promise<unknown>): Promise<VoiceProviderError> => {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(VoiceProviderError)
  return error as VoiceProviderError
}

describe('parseRetryDelaySec', () => {
  it('「retry in 48.3s」「retry in 19h22m6s」の秒数を読む', () => {
    expect(parseRetryDelaySec('Quota exceeded. Please retry in 48.3s.')).toBeCloseTo(48.3, 6)
    expect(parseRetryDelaySec('{"message":"retry in 19h22m6s"}')).toBe(19 * 3600 + 22 * 60 + 6)
    expect(parseRetryDelaySec('retry in 2m')).toBe(120)
  })

  it('無ければ null。600 字より後ろは見ない', () => {
    expect(parseRetryDelaySec('Resource exhausted')).toBeNull()
    expect(parseRetryDelaySec(`${'x'.repeat(600)} retry in 5s`)).toBeNull()
  })
})

describe('429 は待って送り直す', () => {
  it('返答の秒数 +2 秒待って送り直す', async () => {
    const fake = sequence([() => text('Please retry in 48s', 429), audioResponse])
    await voiceWith(fake).speak(request())
    expect(fake.waits).toEqual([50_000])
    expect(fake.calls).toHaveLength(2)
  })

  it('秒数が無ければ 30 秒 +2 秒', async () => {
    const fake = sequence([() => json({ error: { message: 'exhausted' } }, 429), audioResponse])
    await voiceWith(fake).speak(request())
    expect(fake.waits).toEqual([32_000])
  })

  it('90 秒を超えて待つなら、待たずに理由を出して止める（鍵は文に入れない）', async () => {
    const fake = sequence([() => text(`retry in 19h22m6s ${KEY}`, 429)])
    const error = await failure(voiceWith(fake).speak(request()))
    expect(error.code).toBe('rate_limited')
    expect(error.retryable).toBe(false)
    expect(error.message).toContain('約 19 時間 22 分')
    expect(error.message).not.toContain(KEY)
    expect(fake.waits).toEqual([])
    expect(fake.calls).toHaveLength(1)
  })

  it('88 秒（+2 で 90 秒）までは待つ', async () => {
    const fake = sequence([() => text('retry in 88s', 429), audioResponse])
    await voiceWith(fake).speak(request())
    expect(fake.waits).toEqual([90_000])
  })

  it('89 秒（+2 で 91 秒）なら止める', async () => {
    const fake = sequence([() => text('retry in 89s', 429)])
    const error = await failure(voiceWith(fake).speak(request()))
    expect(error.message).toContain('約 2 分')
    expect(fake.waits).toEqual([])
  })

  it('送り直すのは 4 回まで', async () => {
    const fake = sequence([() => text('retry in 1s', 429)])
    const error = await failure(voiceWith(fake).speak(request()))
    expect(error.code).toBe('rate_limited')
    expect(fake.calls).toHaveLength(5)
    expect(fake.waits).toEqual([3000, 3000, 3000, 3000])
  })
})

describe('500 以上は 2・5・10 秒待って 3 回まで', () => {
  it('送り直して成功する', async () => {
    const fake = sequence([() => text('x', 500), () => text('x', 503), () => text('x', 500), audioResponse])
    await voiceWith(fake).speak(request())
    expect(fake.waits).toEqual([2000, 5000, 10_000])
  })

  it('4 回目も 500 なら失敗にする', async () => {
    const fake = sequence([() => text('x', 500)])
    const error = await failure(voiceWith(fake).speak(request()))
    expect(error.code).toBe('unavailable')
    expect(fake.calls).toHaveLength(4)
  })

  it('400 は送り直さない', async () => {
    const fake = sequence([() => text('x', 400)])
    const error = await failure(voiceWith(fake).speak(request()))
    expect(error.code).toBe('bad_request')
    expect(fake.calls).toHaveLength(1)
  })
})

describe('打ち切り', () => {
  it('応答が無ければ打ち切って「応答しませんでした」', async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const voice = createGeminiVoice({ apiKey: KEY, fetch: hanging, timeoutMs: 20, costOf: () => 0 })
    const error = await failure(voice.speak(request()))
    expect(error.code).toBe('unavailable')
    expect(error.message).toContain('応答しませんでした')
  })
})

describe('作った声（voice_…）は interactions で読む', () => {
  const wav = pcm16Wav(new Int16Array(24000), 24000)
  const interactions = (steps: unknown) => () => json({ steps })

  it('要求の形（読み方の指示は annotations）。鍵はヘッダーだけ', async () => {
    const fake = sequence([interactions([{ type: 'model_output', content: [{ type: 'audio', data: wav.toString('base64') }] }])])
    const result = await voiceWith(fake, ({ outputTokens }: { outputTokens: number }) => outputTokens / 1000).speak(
      request({ voiceName: 'voice_abc123' }),
    )

    expect(fake.calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    expect(fake.calls[0]?.url).not.toContain(KEY)
    expect(fake.calls[0]?.headers.get('x-goog-api-key')).toBe(KEY)
    expect(sentJson(fake.calls[0])).toEqual({
      model: 'gemini-3.8-flash-tts',
      input: [
        {
          type: 'user_input',
          content: [{ type: 'text', text: 'ねえ、ネズミくん。', annotations: [{ type: 'speech_metadata', style: 'からかうように' }] }],
        },
      ],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: 'voice_abc123' }] },
    })
    // 1 秒の音 = 25 トークンの見積もり。
    expect(result.costUsd).toBeCloseTo(0.025, 6)
    expect(result.record).toMatchObject({ voice: 'voice_abc123', outputTokens: 25, outputTokensEstimated: true, endpoint: 'interactions' })
    expect(result.sentStyle).toBe('からかうように')
    expect(JSON.stringify(result.record)).not.toContain(KEY)
    expect(await readFile(result.audioPath)).toEqual(wav)
  })

  it('読み方の指示が無ければ annotations を鍵ごと省く', async () => {
    const fake = sequence([interactions([{ type: 'model_output', content: [{ type: 'audio', data: wav.toString('base64') }] }])])
    await voiceWith(fake).speak(request({ voiceName: 'voice_abc123', direction: '' }))
    expect(JSON.stringify(sentJson(fake.calls[0]))).not.toContain('annotations')
  })

  it('model_output の audio のうち最後の 1 つを使う', async () => {
    const last = pcm16Wav(new Int16Array([1, 2, 3]), 24000)
    const fake = sequence([
      interactions([
        { type: 'thought', content: [{ type: 'audio', data: 'AAAA' }] },
        { type: 'model_output', content: [{ type: 'audio', data: wav.toString('base64') }, { type: 'text' }] },
        { type: 'model_output', content: [{ type: 'audio', data: last.toString('base64') }] },
      ]),
    ])
    const result = await voiceWith(fake).speak(request({ voiceName: 'voice_abc123' }))
    expect(await readFile(result.audioPath)).toEqual(last)
  })

  it('音が無ければ形が違うと失敗する（鍵は文に入れない）', async () => {
    const fake = sequence([interactions([{ type: 'model_output', content: [{ type: 'text' }] }])])
    const error = await failure(voiceWith(fake).speak(request({ voiceName: 'voice_abc123' })))
    expect(error.code).toBe('bad_response')
    expect(error.message).not.toContain(KEY)
  })

  it('既製の声は今まで通り generateContent（作った声の口を通らない）', async () => {
    const fake = sequence([audioResponse])
    await voiceWith(fake).speak(request())
    expect(fake.calls[0]?.url).toContain(':generateContent')
  })

  it('作った声でも 429 は待って送り直す', async () => {
    const fake = sequence([() => text('retry in 3s', 429), interactions([{ type: 'model_output', content: [{ type: 'audio', data: wav.toString('base64') }] }])])
    await voiceWith(fake).speak(request({ voiceName: 'voice_abc123' }))
    expect(fake.waits).toEqual([5000])
  })
})

describe('designVoice', () => {
  const designer = (fake: ReturnType<typeof sequence>) => createGeminiVoiceDesigner({ apiKey: KEY, fetch: fake.fetch, sleep: fake.sleep })

  it('v1beta/voices に説明を送り、voice_… の ID と試し聞きを受け取る', async () => {
    const sample = Buffer.from('RIFF-sample')
    const fake = sequence([() => json({ id: 'voice_9f8e', sample_audio: { data: sample.toString('base64') } })])
    const result = await designer(fake).designVoice({ description: '低めでからかう若い女性の声', gender: 'female', displayName: 'ネコ' })

    expect(fake.calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/voices')
    expect(fake.calls[0]?.url).not.toContain(KEY)
    expect(fake.calls[0]?.headers.get('x-goog-api-key')).toBe(KEY)
    expect(sentJson(fake.calls[0])).toEqual({
      store: true,
      voice: {
        model: 'gemini-3.8-flash-tts',
        type: 'prompted',
        display_name: 'ネコ',
        gender: 'female',
        language_code: 'ja-JP',
        prompted: { input: '低めでからかう若い女性の声' },
      },
    })
    expect(result).toEqual({ voiceId: 'voice_9f8e', sampleWav: sample })
  })

  it('試し聞きが無ければ null', async () => {
    const fake = sequence([() => json({ id: 'voice_9f8e' })])
    expect((await designer(fake).designVoice({ description: '声', gender: 'male', displayName: 'ネズミ' })).sampleWav).toBeNull()
  })

  it('voice_ で始まらない ID は形が違うと失敗する', async () => {
    const fake = sequence([() => json({ id: 'Kore' })])
    const error = await failure(designer(fake).designVoice({ description: '声', gender: 'male', displayName: 'ネズミ' }))
    expect(error.code).toBe('bad_response')
  })

  it('説明が空・知らない性別は送らずに拒む', async () => {
    const fake = sequence([() => json({ id: 'voice_1' })])
    await expect(designer(fake).designVoice({ description: ' ', gender: 'male', displayName: 'x' })).rejects.toThrow()
    await expect(designer(fake).designVoice({ description: '声', gender: 'other' as 'male', displayName: 'x' })).rejects.toThrow()
    expect(fake.calls).toHaveLength(0)
  })

  it('429 は待って送り直す', async () => {
    const fake = sequence([() => text('retry in 10s', 429), () => json({ id: 'voice_1' })])
    await designer(fake).designVoice({ description: '声', gender: 'male', displayName: 'x' })
    expect(fake.waits).toEqual([12_000])
  })
})
