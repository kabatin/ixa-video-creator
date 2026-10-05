import { describe, expect, it } from 'vitest'
import { VOICE_TARGET_LUFS, peaksFromPcm, voiceGainDb, voiceNormalizeArgs, whisperWavArgs } from '../voice-audio.js'

/**
 * 声の音を整える（ADR-0038）。短い声でも予測できるよう、測った大きさから一定の増減（dB）を掛け、
 * 頭打ち（リミッター）で割れを防ぐ。録音は軽いノイズ除去も掛ける。
 */

describe('voiceGainDb', () => {
  it(`目標（${VOICE_TARGET_LUFS} LUFS）との差を掛ける`, () => {
    expect(voiceGainDb(-20)).toBe(4)
    expect(voiceGainDb(-10)).toBe(-6)
  })

  it('増減は ±20 dB まで。無音（測れない）なら 0', () => {
    expect(voiceGainDb(-60)).toBe(20)
    expect(voiceGainDb(Number.NEGATIVE_INFINITY)).toBe(0)
  })
})

describe('voiceNormalizeArgs', () => {
  it('モノラル 48kHz にし、増減と頭打ち（持ち上げない）を掛けて AAC（m4a）で書く', () => {
    expect(voiceNormalizeArgs('/in.aiff', '/out.m4a', { gainDb: 4, denoise: false })).toEqual([
      '-y', '-i', '/in.aiff', '-vn', '-ac', '1', '-ar', '48000',
      '-af', 'volume=4dB,alimiter=limit=0.8:level=false',
      '-c:a', 'aac', '-b:a', '160k', '/out.m4a',
    ])
  })

  it('録音は低い雑音を切り、軽いノイズ除去を先に掛ける', () => {
    expect(voiceNormalizeArgs('/rec.wav', '/out.m4a', { gainDb: 0, denoise: true })).toContain(
      'highpass=f=70,afftdn=nf=-25,volume=0dB,alimiter=limit=0.8:level=false',
    )
  })
})

describe('whisperWavArgs', () => {
  it('whisper.cpp 向けに 16kHz・モノラル・16 ビットの WAV にする', () => {
    expect(whisperWavArgs('/in.m4a', '/out.wav')).toEqual(['-y', '-i', '/in.m4a', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '/out.wav'])
  })
})

describe('peaksFromPcm', () => {
  it('区切りごとの最大の振れ幅（0〜1）を返す', () => {
    const samples = Int16Array.from([0, 16384, -32768, 100, 0, -8192])
    expect(peaksFromPcm(samples, 3)).toEqual([0.5, 1, 0.25])
  })

  it('点の数が音より多ければ、音の数で返す。音が無ければ空', () => {
    expect(peaksFromPcm(Int16Array.from([32767]), 5)).toEqual([1])
    expect(peaksFromPcm(new Int16Array(0), 5)).toEqual([])
  })
})
