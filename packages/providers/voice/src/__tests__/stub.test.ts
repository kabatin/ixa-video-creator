import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStubTranscriber, createStubVoice, STUB_CHAR_SEC } from '../stub.js'
import { pcm16Wav, rateFromMime, wavFromPcm } from '../wav.js'

/**
 * お試しの声と文字起こし（ADR-0038）。AI を使わず、外にも出さない。
 * 字ごとに時刻を付けるので、話している字を強調する字幕の流れも無料で確かめられる。
 */

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'voice-stub-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('wav', () => {
  it('16 ビット・モノラルの WAV を書く（RIFF の頭・サンプルの速さ・データの長さ）', () => {
    const wav = pcm16Wav(new Int16Array([0, 1000, -1000]), 24000)

    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(wav.readUInt32LE(24)).toBe(24000)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.readUInt32LE(40)).toBe(6)
    expect(wav.length).toBe(44 + 6)
  })

  it('頭の無い PCM を WAV に包む', () => {
    const wav = wavFromPcm(Buffer.from([1, 0, 2, 0]), 16000)
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(wav.subarray(44)).toEqual(Buffer.from([1, 0, 2, 0]))
  })

  it('MIME の rate を読む（無ければ 24000）', () => {
    expect(rateFromMime('audio/L16;codec=pcm;rate=16000')).toBe(16000)
    expect(rateFromMime('audio/L16')).toBe(24000)
  })
})

describe('createStubVoice', () => {
  it(`1 字 ${STUB_CHAR_SEC} 秒の長さの音を WAV で書き、字ごとの時刻を返す（費用 0）`, async () => {
    const voice = createStubVoice()

    const result = await voice.speak({
      text: 'すすめ',
      model: null,
      voiceName: 'stub',
      styleNote: '',
      direction: '',
      speed: 1,
      tuning: {},
      language: 'ja',
      outputBasePath: join(dir, 'line'),
    })

    expect(result.audioPath).toBe(join(dir, 'line.wav'))
    expect(result.costUsd).toBe(0)
    expect(result.charTimes?.map((t) => t.char)).toEqual(['す', 'す', 'め'])
    const wav = await readFile(result.audioPath)
    const seconds = wav.readUInt32LE(40) / 2 / wav.readUInt32LE(24)
    // 短すぎると読めないので 0.5 秒より短くしない。
    expect(seconds).toBeCloseTo(Math.max(0.5, 3 * STUB_CHAR_SEC), 2)
    expect(result.charTimes?.at(-1)?.endSec).toBeCloseTo(seconds, 2)
  })

  it('声は「お試しの声」1 つ', async () => {
    expect(await createStubVoice().listVoices('ja')).toEqual([{ id: 'stub', label: 'お試しの声', note: null }])
  })
})

describe('createStubTranscriber', () => {
  it('決まった文を、音の長さ（3 秒まで）の区間で返す（費用 0）', async () => {
    const result = await createStubTranscriber().transcribe({
      audioPath: join(dir, 'x.wav'),
      language: 'ja',
      keyterms: [],
      workDir: dir,
      durationSec: 10,
    })

    expect(result.text).toBe('お試しの文字起こしです。')
    expect(result.segments).toEqual([{ text: 'お試しの文字起こしです。', startSec: 0, endSec: 3 }])
    expect(result.chars).toBeNull()
    expect(result.costUsd).toBe(0)
  })
})
