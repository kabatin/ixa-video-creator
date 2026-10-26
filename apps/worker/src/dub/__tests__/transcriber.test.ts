import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAudioServiceTranscriber, wavFromPcm } from '../transcriber.js'

/** apps/audio の `POST /transcribe` の口（契約。実のサービスは呼ばない）。 */

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ixa-dub-transcribe-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const PCM = Int16Array.from({ length: 1600 }, (_, i) => (i % 2 === 0 ? 1000 : -1000))

describe('createAudioServiceTranscriber', () => {
  it('音を AUDIO_ROOT に WAV で置き、相対パス・日本語・台本・語の時刻を頼み、語を秒で返して、置いた音を消す', async () => {
    const seen: { url: string; body: unknown; wav: Uint8Array }[] = []
    const fakeFetch: typeof fetch = async (url, init) => {
      const raw = typeof init?.body === 'string' ? init.body : ''
      const body = JSON.parse(raw) as { audio_path: string }
      seen.push({ url: typeof url === 'string' ? url : '', body, wav: await readFile(join(root, body.audio_path)) })
      return json({
        model: 'small',
        language: 'ja',
        segments: [
          { start: 1.04, end: 4.76, text: 'ねえねずみくん', words: [{ start: 1.04, end: 2.4, text: 'ねえ' }, { start: 2.4, end: 4.76, text: 'ねずみくん' }] },
          { start: 4.76, end: 6.06, text: 'な何ですか', words: [] },
        ],
      })
    }
    const transcribe = createAudioServiceTranscriber({ baseUrl: 'http://127.0.0.1:8100/', audioRoot: root, fetch: fakeFetch })
    const words = await transcribe({ pcm: PCM, key: 'job1', prompt: 'ねえ、ネズミくん。 な、なんですか。' })

    expect(words).toEqual([
      { startSec: 1.04, endSec: 2.4, text: 'ねえ' },
      { startSec: 2.4, endSec: 4.76, text: 'ねずみくん' },
      // 語の無い区切りは、区切りを 1 語とみなす
      { startSec: 4.76, endSec: 6.06, text: 'な何ですか' },
    ])
    expect(seen[0]?.url).toBe('http://127.0.0.1:8100/transcribe')
    expect(seen[0]?.body).toEqual({
      audio_path: 'dub-job1/source.wav',
      language: 'ja',
      initial_prompt: 'ねえ、ネズミくん。 な、なんですか。',
      word_timestamps: true,
    })
    expect(Buffer.from(seen[0]?.wav ?? []).equals(Buffer.from(wavFromPcm(PCM, 16000)))).toBe(true)
    expect(await readdir(root)).toEqual([])
  })

  it('WAV は 16 kHz・モノラル・16 ビットの RIFF', () => {
    const wav = Buffer.from(wavFromPcm(PCM, 16000))
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.readUInt32LE(40)).toBe(PCM.byteLength)
    expect(wav.length).toBe(44 + PCM.byteLength)
  })

  it('サービスが断った・応答の形が違う・つながらないなら、文脈を付けて投げ、置いた音は消す', async () => {
    const cases: readonly [typeof fetch, string][] = [
      [() => Promise.resolve(new Response('モデルを読めませんでした', { status: 503 })), '503'],
      [() => Promise.resolve(json({ segments: [{ start: -1, end: 1, text: 'x', words: [] }] })), '応答の形'],
      [() => Promise.reject(new TypeError('fetch failed')), 'fetch failed'],
    ]
    for (const [fakeFetch, expected] of cases) {
      const transcribe = createAudioServiceTranscriber({ baseUrl: 'http://127.0.0.1:8100', audioRoot: root, fetch: fakeFetch })
      await expect(transcribe({ pcm: PCM, key: 'job2', prompt: '' })).rejects.toThrow(expected)
      expect(await readdir(root)).toEqual([])
    }
  })
})
