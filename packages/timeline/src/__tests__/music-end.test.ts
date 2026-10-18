import { describe, expect, it } from 'vitest'
import { buildTimelineDocument, type TimelineMusicTrack } from '../build.js'
import { TIMELINE_ISSUE_CODES, validateTimeline } from '../validate.js'
import { makeShot, makeSource } from './fixtures.js'

/**
 * 曲の終わり（制作者 2026-10-19「カットの合計尺より音楽が長いと最後に黒画面が出来てしまう」）。
 * 宣伝動画は Shot が 26.38 秒で終わるのに曲が 32 秒あり、26.38〜32 秒が黒画面で書き出されていた。
 */
const shots = [makeShot(1, 0, 13.19), makeShot(2, 13.19, 13.19)]
const song = (extra: Partial<TimelineMusicTrack> = {}): readonly TimelineMusicTrack[] => [
  { mediaUrl: 'https://media.test/m.mp3', startSec: 0, durationSec: 32, volume: 1, ...extra },
]

describe('曲の終わり', () => {
  it('決めると尺と曲がそこで終わり、黒画面の警告が消える', () => {
    const source = makeSource({ shots, musicTracks: song({ endSec: 26.38, fadeOutSec: 0.5 }) })
    const doc = buildTimelineDocument(source)

    expect(doc.durationSec).toBeCloseTo(26.38)
    expect(doc.audio[0]?.durationSec).toBeCloseTo(26.38)
    expect(doc.audio[0]?.fadeOutSec).toBe(0.5)
    expect(validateTimeline(source).filter((issue) => issue.code === TIMELINE_ISSUE_CODES.shotGapTail)).toEqual([])
  })

  it('無ければ今までどおり曲の終わりまで伸び、黒画面を警告する（ミュージックビデオの既定）', () => {
    for (const extra of [{}, { endSec: null }]) {
      const source = makeSource({ shots, musicTracks: song(extra) })
      expect(buildTimelineDocument(source).durationSec).toBe(32)
      expect(validateTimeline(source).map((issue) => issue.code)).toContain(TIMELINE_ISSUE_CODES.shotGapTail)
    }
  })

  it('開始位置をずらした曲は、タイムライン上の秒で止まる', () => {
    const doc = buildTimelineDocument(makeSource({ shots, musicTracks: song({ startSec: 2, endSec: 26.38 }) }))

    expect(doc.audio[0]?.startSec).toBe(2)
    expect(doc.audio[0]?.durationSec).toBeCloseTo(24.38)
    expect(doc.durationSec).toBeCloseTo(26.38)
  })

  it('Shot より前で止めても、尺は Shot の終わりまである（映像は切らない）', () => {
    const doc = buildTimelineDocument(makeSource({ shots, musicTracks: song({ endSec: 20 }) }))

    expect(doc.audio[0]?.durationSec).toBe(20)
    expect(doc.durationSec).toBeCloseTo(26.38)
  })
})
