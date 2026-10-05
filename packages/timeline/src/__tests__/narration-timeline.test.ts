import { describe, expect, it } from 'vitest'
import { buildTimelineDocument, type TimelineVoice } from '../build.js'
import { TIMELINE_ISSUE_CODES, validateTimeline } from '../validate.js'
import { makeShot, makeSource } from './fixtures.js'

/**
 * ナレーション（ADR-0038）をタイムラインに載せる。行の声は音の 1 本として audio に入り（role: voice）、
 * 尺は声の終わりまで伸びる。BGM のダッキングの設定も文書に載せる（プレビューと書き出しが同じ設定で鳴らす）。
 */

const voice = (startSec: number, durationSec: number, patch: Partial<TimelineVoice> = {}): TimelineVoice => ({
  mediaUrl: `https://media.test/voice-${startSec}.m4a`,
  startSec,
  durationSec,
  inSec: 0,
  volume: 1,
  ...patch,
})

describe('buildTimelineDocument（ナレーション）', () => {
  it('声は audio に role: voice で入る（区間の頭も渡す）。曲は role を持たない（無ければ曲。前からの書き出しの記録と同じ形）', () => {
    const doc = buildTimelineDocument(
      makeSource({
        musicTracks: [{ mediaUrl: 'https://media.test/bgm.mp3', startSec: 0, durationSec: 10, volume: 0.8 }],
        voices: [voice(2, 1.5, { inSec: 3, volume: 0.9 })],
      }),
    )

    expect(doc.audio).toEqual([
      { mediaUrl: 'https://media.test/bgm.mp3', startSec: 0, durationSec: 10, volume: 0.8 },
      { mediaUrl: 'https://media.test/voice-2.m4a', startSec: 2, durationSec: 1.5, volume: 0.9, inSec: 3, role: 'voice' },
    ])
  })

  it('尺は声の終わりまで伸びる（曲も Shot も無い作品でも鳴る）', () => {
    expect(buildTimelineDocument(makeSource({ voices: [voice(4, 2)] })).durationSec).toBe(6)
  })

  it('ダッキングの設定を文書に載せる（無ければ載せない）', () => {
    const ducking = { enabled: true, depthDb: 10, attackSec: 0.15, releaseSec: 0.4 }
    expect(buildTimelineDocument(makeSource({ ducking })).ducking).toEqual(ducking)
    expect(buildTimelineDocument(makeSource()).ducking).toBeUndefined()
  })
})

describe('validateTimeline（ナレーション）', () => {
  it('声どうしが重なっていれば知らせる（warning）', () => {
    const issues = validateTimeline(makeSource({ voices: [voice(0, 2), voice(1.5, 1)] }))
    expect(issues.map((issue) => [issue.severity, issue.code])).toContainEqual(['warning', TIMELINE_ISSUE_CODES.voiceOverlap])
  })

  it('最後の Shot より後ろまで声が続けば知らせる（Shot が無ければ言わない）', () => {
    const withShots = validateTimeline(makeSource({ shots: [makeShot(1, 0, 3)], voices: [voice(2, 2)] }))
    expect(withShots.map((issue) => issue.code)).toContain(TIMELINE_ISSUE_CODES.voiceOutOfRange)
    expect(validateTimeline(makeSource({ voices: [voice(2, 2)] })).map((issue) => issue.code)).not.toContain(
      TIMELINE_ISSUE_CODES.voiceOutOfRange,
    )
  })
})
