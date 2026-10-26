import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runFfmpeg } from '../ffmpeg-runner.js'
import { detectSpeechSegments, parseSilenceDetect, speechSegmentsFromStderr } from '../speech-segments.js'
import { createTempDir, removeTempDir } from './fixtures.js'

/**
 * Take の音から、話している区間を拾う（ADR-0061）。無音（silencedetect）の裏返し。
 * セリフの字幕の時刻は、この区間を行の順に当てる。
 */

const TIMEOUT_MS = 120_000

describe('parseSilenceDetect', () => {
  it('無音の間を裏返して、音のある区間にする（頭と尻も）', () => {
    const stderr = [
      '[silencedetect @ 0x1] silence_start: 0',
      '[silencedetect @ 0x1] silence_end: 0.4 | silence_duration: 0.4',
      '[silencedetect @ 0x1] silence_start: 1.2',
      '[silencedetect @ 0x1] silence_end: 1.9 | silence_duration: 0.7',
    ].join('\n')
    expect(parseSilenceDetect(stderr, 3)).toEqual([
      { startSec: 0.4, endSec: 1.2 },
      { startSec: 1.9, endSec: 3 },
    ])
  })

  it('最後まで無音のまま終わる（silence_end が無い）なら、そこで区間を閉じる', () => {
    const stderr = ['silence_start: 0', 'silence_end: 0.5 | silence_duration: 0.5', 'silence_start: 2.25'].join('\n')
    expect(parseSilenceDetect(stderr, 3)).toEqual([{ startSec: 0.5, endSec: 2.25 }])
  })

  it('無音が 1 つも無ければ、全体が 1 つの区間', () => {
    expect(parseSilenceDetect('', 2.5)).toEqual([{ startSec: 0, endSec: 2.5 }])
  })

  it('ごく短い音（物音）は区間にしない', () => {
    const stderr = ['silence_start: 0', 'silence_end: 1 | silence_duration: 1', 'silence_start: 1.05'].join('\n')
    expect(parseSilenceDetect(stderr, 3)).toEqual([])
  })

  it('出力の頭が切れていれば（stderr は末尾だけ残す）、区間は「分からない」（null）。頭の無音を 0 秒からの声と取り違えない', () => {
    const tail = ['silence_end: 1.5 | silence_duration: 0.5', 'silence_start: 2'].join('\n')
    expect(speechSegmentsFromStderr(tail, 3, { truncated: true })).toBeNull()
    expect(speechSegmentsFromStderr(tail, 3, { truncated: false })).toEqual(parseSilenceDetect(tail, 3))
  })

  it('尺が分からない（0 以下）なら区間を作らない', () => {
    expect(parseSilenceDetect('', 0)).toEqual([])
  })
})

let workDir = ''

/** 映像と音の mp4。音は `expr`（aevalsrc の式）。 */
const makeVideo = async (name: string, expr: string, durationSec: number): Promise<string> => {
  const path = join(workDir, name)
  await runFfmpeg([
    '-y',
    '-f', 'lavfi', '-i', `color=c=black:size=160x120:rate=12:duration=${String(durationSec)}`,
    '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=48000:d=${String(durationSec)}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', path,
  ])
  return path
}

beforeAll(async () => {
  workDir = await createTempDir()
}, TIMEOUT_MS)

afterAll(async () => {
  if (workDir !== '') await removeTempDir(workDir)
})

describe('detectSpeechSegments（実 ffmpeg）', () => {
  it(
    '声の区間（0.3〜1.0 と 1.6〜2.6 秒）を拾う',
    async () => {
      const tone = '0.5*sin(2*PI*440*t)'
      const path = await makeVideo('two-lines.mp4', `${tone}*(between(t,0.3,1.0)+between(t,1.6,2.6))`, 3)
      const segments = (await detectSpeechSegments(path, 3)) ?? []
      expect(segments).toHaveLength(2)
      expect(segments[0]?.startSec).toBeCloseTo(0.3, 1)
      expect(segments[0]?.endSec).toBeCloseTo(1.0, 1)
      expect(segments[1]?.startSec).toBeCloseTo(1.6, 1)
      expect(segments[1]?.endSec).toBeCloseTo(2.6, 1)
    },
    TIMEOUT_MS,
  )

  it(
    '無音の音のトラックなら区間は無い',
    async () => {
      const path = await makeVideo('silent.mp4', '0', 2)
      expect(await detectSpeechSegments(path, 2)).toEqual([])
    },
    TIMEOUT_MS,
  )
})
