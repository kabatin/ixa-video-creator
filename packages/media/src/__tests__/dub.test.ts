import { join } from 'node:path'
import { speechChunks } from '@ixa/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { measureLoudness } from '../audio.js'
import { atempoChain, stretchChunks } from '../dub/stretch-chunks.js'
import { DUB_TARGET_LUFS, mixDub, muteExpression } from '../dub/mix-dub.js'
import { matchLevelGainDb, voicedLevelOfPcm } from '../dub/match-level.js'
import { DUB_PCM_RATE, readPcm16k, readRmsFrames, rmsFramesFromPcm } from '../dub/rms-frames.js'
import { probeMedia } from '../probe.js'
import { runFfmpeg } from '../ffmpeg-runner.js'
import { createTempDir, removeTempDir } from './fixtures.js'

/**
 * 声の差し替えの音の作り（ADR-0062）。**実 ffmpeg** で、合成した音から測る。
 * 元の声は 300Hz（0.5〜1.0 秒と 1.8〜2.4 秒）、環境音は 3000Hz（ずっと小さく鳴る）、読み上げは 500Hz。
 */

let dir = ''
const at = (name: string): string => join(dir, name)

const SOURCE_EXPR = '0.2*sin(2*PI*300*t)*(between(t,0.5,1.0)+between(t,1.8,2.4))+0.004*sin(2*PI*3000*t)'

const makeAudio = async (path: string, expr: string, durationSec: number): Promise<void> => {
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=48000:d=${durationSec}`, '-c:a', 'pcm_s16le', path])
}

const makeSourceVideo = async (path: string): Promise<void> => {
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=24:duration=3',
    '-f', 'lavfi', '-i', `aevalsrc='${SOURCE_EXPR}':s=48000:d=3`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', path,
  ])
}

/** Goertzel で、区間の中のある周波数の大きさ（振れ幅の目安）。 */
const toneLevel = (samples: Int16Array, hz: number, startSec: number, endSec: number): number => {
  const from = Math.floor(startSec * DUB_PCM_RATE)
  const to = Math.min(samples.length, Math.floor(endSec * DUB_PCM_RATE))
  const coeff = 2 * Math.cos((2 * Math.PI * hz) / DUB_PCM_RATE)
  let s1 = 0
  let s2 = 0
  for (let i = from; i < to; i += 1) {
    const s0 = (samples[i] ?? 0) / 32768 + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  const n = Math.max(1, to - from)
  return (2 * Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2)) / n
}

beforeAll(async () => {
  dir = await createTempDir()
  await makeSourceVideo(at('source.mp4'))
  // 読み上げ: 0.2〜0.7 秒に 500Hz（頭と尻は無音）。
  await makeAudio(at('tts.wav'), '0.1*sin(2*PI*500*t)*between(t,0.2,0.7)', 1)
}, 30_000)

afterAll(async () => {
  await removeTempDir(dir)
})

describe('rmsFrames と声の区間', () => {
  it('16kHz・10ms 刻みの dB から、元の声の 2 つの区間を拾う（環境音は拾わない）', async () => {
    const chunks = speechChunks(await readRmsFrames(at('source.mp4'), at('source.raw')))
    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.startSec).toBeCloseTo(0.5, 1)
    expect(chunks[0]?.endSec).toBeCloseTo(1.0, 1)
    expect(chunks[1]?.startSec).toBeCloseTo(1.8, 1)
    expect(chunks[1]?.endSec).toBeCloseTo(2.4, 1)
  })

  it('窓 400・刻み 160 の RMS（全振幅の正弦波は約 -3 dBFS、無音は -Infinity）', () => {
    const sine = Int16Array.from({ length: 1600 }, (_, i) => Math.round(32767 * Math.sin((2 * Math.PI * 500 * i) / DUB_PCM_RATE)))
    const frames = rmsFramesFromPcm(sine)
    expect(frames).toHaveLength(8)
    expect(frames[0]).toBeCloseTo(-3.01, 1)
    expect(rmsFramesFromPcm(new Int16Array(400))[0]).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('stretchChunks', () => {
  it('atempo は 0.5〜2.0 の段に分ける', () => {
    expect(atempoChain(1.25)).toEqual([1.25])
    expect(atempoChain(3)).toEqual([2, 1.5])
    expect(atempoChain(0.3)).toEqual([0.5, 0.6])
  })

  it('切り出してつなぎ、一定の倍率で縮める（長さ = つないだ長さ ÷ 倍率）', async () => {
    await stretchChunks(at('tts.wav'), at('stretched.wav'), { pieces: [{ startSec: 0.16, endSec: 0.46 }, { startSec: 0.5, endSec: 0.76 }], tempo: 1.25 })
    const probe = await probeMedia(at('stretched.wav'))
    expect(probe.durationSec).toBeCloseTo(0.56 / 1.25, 1)
  })

  it('切る長さで切る', async () => {
    await stretchChunks(at('tts.wav'), at('cut.wav'), { pieces: [{ startSec: 0, endSec: 1 }], tempo: 1, cut: { durationSec: 0.4, fadeOutSec: 0.15 } })
    const probe = await probeMedia(at('cut.wav'))
    expect(probe.durationSec).toBeCloseTo(0.4, 2)
  })
})

describe('matchLevel', () => {
  it('声のある所の大きさを元の声に合わせ、距離の dB を足す', () => {
    const tone = (amp: number) =>
      Int16Array.from({ length: DUB_PCM_RATE }, (_, i) => Math.round(32767 * amp * Math.sin((2 * Math.PI * 300 * i) / DUB_PCM_RATE)))
    const source = voicedLevelOfPcm(tone(0.2))
    const voice = voicedLevelOfPcm(tone(0.1))
    expect(matchLevelGainDb({ sourceLevelDb: source, voiceLevelDb: voice, levelDb: 0 })).toBeCloseTo(6.02, 1)
    expect(matchLevelGainDb({ sourceLevelDb: source, voiceLevelDb: voice, levelDb: -9.5 })).toBeCloseTo(-3.48, 1)
    expect(matchLevelGainDb({ sourceLevelDb: null, voiceLevelDb: voice, levelDb: -2 })).toBe(-2)
  })
})

describe('mixDub', () => {
  it('消す式は範囲の中だけ 0', () => {
    expect(muteExpression([])).toBe('1')
    expect(muteExpression([{ startSec: 0.45, endSec: 1.1 }, { startSec: 2, endSec: 2.5 }])).toBe(
      'if(between(t,0.4500,1.1000)+between(t,2.0000,2.5000),0,1)',
    )
  })

  it(`範囲の中だけ元の音を消し、声を置いた時刻から鳴らし、${DUB_TARGET_LUFS} LUFS にそろえる。映像は写す`, async () => {
    // 読み上げを 0.2 秒から切り出す → 0.5 秒に置くと、500Hz は 0.5〜1.0 秒に鳴る。
    await stretchChunks(at('tts.wav'), at('voice.wav'), { pieces: [{ startSec: 0.2, endSec: 0.7 }], tempo: 1 })
    const loudness = await mixDub(
      { videoPath: at('source.mp4'), voices: [{ path: at('voice.wav'), startSec: 0.5, gainDb: 0 }], muteRanges: [{ startSec: 0.45, endSec: 1.1 }] },
      at('dubbed.mp4'),
    )
    expect(loudness.integratedLufs).toBeGreaterThan(-16.5)
    expect(loudness.integratedLufs).toBeLessThan(-15.5)
    expect((await measureLoudness(at('dubbed.mp4'))).integratedLufs).toBeCloseTo(loudness.integratedLufs, 5)

    const probe = await probeMedia(at('dubbed.mp4'))
    expect(probe.hasAudio).toBe(true)
    expect(probe.durationSec).toBeCloseTo(3, 0)

    const pcm = await readPcm16k(at('dubbed.mp4'), at('dubbed.raw'))
    // 消す範囲の中: 元の声（300Hz）も環境音（3000Hz）も無く、読み上げ（500Hz）だけ。
    expect(toneLevel(pcm, 300, 0.6, 0.9)).toBeLessThan(0.002)
    expect(toneLevel(pcm, 3000, 0.6, 0.9)).toBeLessThan(0.0005)
    expect(toneLevel(pcm, 500, 0.6, 0.9)).toBeGreaterThan(0.02)
    // 範囲の外: 元の声と環境音が残り、読み上げは鳴らない。
    expect(toneLevel(pcm, 300, 1.9, 2.3)).toBeGreaterThan(0.05)
    expect(toneLevel(pcm, 3000, 1.3, 1.7)).toBeGreaterThan(0.001)
    expect(toneLevel(pcm, 500, 1.3, 1.7)).toBeLessThan(0.002)
    // 置いた時刻: 500Hz は 0.5 秒の前には鳴らず、直後から鳴る。
    expect(toneLevel(pcm, 500, 0.4, 0.48)).toBeLessThan(0.002)
    expect(toneLevel(pcm, 500, 0.52, 0.6)).toBeGreaterThan(0.02)
  }, 30_000)
})

describe('mixDub（ステレオの元の音）', () => {
  it('音量合わせで決めた dB のとおりの大きさで鳴る（モノラルの声をステレオにして 3 dB 下げない）', async () => {
    // 元の声: 300Hz を 0.5〜1.0 秒と 1.8〜2.4 秒に、左右同じ大きさで。読み上げ: 500Hz（大きさは元の半分）。
    const stereo = '0.2*sin(2*PI*300*t)*(between(t,0.5,1.0)+between(t,1.8,2.4))'
    await runFfmpeg([
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=24:duration=3',
      '-f', 'lavfi', '-i', `aevalsrc='${stereo}|${stereo}':s=48000:d=3`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', at('stereo.mp4'),
    ])
    await makeAudio(at('half.wav'), '0.1*sin(2*PI*500*t)', 0.5)

    const source = voicedLevelOfPcm(await readPcm16k(at('stereo.mp4'), at('stereo.raw')), { startSec: 1.8, endSec: 2.4 })
    const voice = voicedLevelOfPcm(await readPcm16k(at('half.wav'), at('half.raw')))
    const gainDb = matchLevelGainDb({ sourceLevelDb: source, voiceLevelDb: voice, levelDb: 0 })

    await mixDub(
      { videoPath: at('stereo.mp4'), voices: [{ path: at('half.wav'), startSec: 0.5, gainDb }], muteRanges: [{ startSec: 0.45, endSec: 1.1 }] },
      at('stereo-dubbed.mp4'),
    )
    const pcm = await readPcm16k(at('stereo-dubbed.mp4'), at('stereo-dubbed.raw'))
    const ratioDb = 20 * Math.log10(toneLevel(pcm, 500, 0.6, 0.9) / toneLevel(pcm, 300, 1.9, 2.3))
    expect(Math.abs(ratioDb)).toBeLessThan(0.5)
  }, 30_000)
})
