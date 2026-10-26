import { describe, expect, it } from 'vitest'
import { MAX_SPEECH_SEGMENTS, MediaProbe } from '../media/media-asset.js'

/** 話している区間（ADR-0061）。取り込みで測り、セリフの字幕の時刻に使う。 */
const base = { durationSec: 3, width: 320, height: 240, fps: 24, hasAudio: true, codec: 'h264' }

describe('MediaProbe.speechSegments', () => {
  it('持たない probe（これを持つ前の素材）はそのまま読める', () => {
    expect(MediaProbe.parse(base)).toEqual(base)
  })

  it('区間を持てる。空の配列は「測ったが無音」', () => {
    const segments = [{ startSec: 0.3, endSec: 1 }]
    expect(MediaProbe.parse({ ...base, speechSegments: segments }).speechSegments).toEqual(segments)
    expect(MediaProbe.parse({ ...base, speechSegments: [] }).speechSegments).toEqual([])
  })

  it.each([
    ['終わりが頭より前', [{ startSec: 1, endSec: 0.5 }]],
    ['長さが 0', [{ startSec: 1, endSec: 1 }]],
    ['負の秒', [{ startSec: -0.1, endSec: 0.5 }]],
    ['多すぎる', Array.from({ length: MAX_SPEECH_SEGMENTS + 1 }, (_, i) => ({ startSec: i, endSec: i + 0.5 }))],
  ])('%s は弾く', (_label, speechSegments) => {
    expect(MediaProbe.safeParse({ ...base, speechSegments }).success).toBe(false)
  })
})
