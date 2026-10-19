import { describe, expect, it } from 'vitest'
import type { MotionEvent } from '../motion/motion-analysis.js'
import {
  MOTION_SFX_SPLIT_OVERLAP_SEC,
  motionEventsOnTimeline,
  motionEventsToSfxCues,
  type TimelineMotionEvent,
} from '../motion/motion-sfx.js'
import { takeSecToTimelineSec } from '../shot/timing.js'
import { SFX_DURATION_MAX_SEC, SFX_DURATION_MIN_SEC, SfxCue } from '../sfx/sfx-job.js'
import { suggestSfxCues } from '../sfx/sfx-suggest.js'

/** Take の秒 → タイムラインの秒と、出来事 → 効果音のきっかけ（ADR-0054 §4）。 */

type Shot = Parameters<typeof takeSecToTimelineSec>[0]

const shot = (overrides: Partial<Shot> = {}): Shot => ({
  startSec: 10,
  durationSec: 4,
  sourceInSec: 0,
  timing: 'trim',
  speed: 1,
  ...overrides,
})

describe('takeSecToTimelineSec', () => {
  it('速さ 1・使い始め 0 なら、Shot の始まりを足すだけ', () => {
    expect(takeSecToTimelineSec(shot(), 1.5, 8)).toBe(11.5)
  })

  it('使い始めを引いて、速さで割る', () => {
    // 速さ 1.5・使い始め 1 秒: Take の 2.5 秒は Shot の頭から (2.5 − 1) / 1.5 = 1 秒
    expect(takeSecToTimelineSec(shot({ sourceInSec: 1, speed: 1.5 }), 2.5, 10)).toBeCloseTo(11)
  })

  it('fit は Take 全体を尺に収める速さで直す', () => {
    // 8 秒の Take を 4 秒に収める → 2 倍
    expect(takeSecToTimelineSec(shot({ timing: 'fit' }), 6, 8)).toBeCloseTo(13)
  })

  it('Shot に映る範囲の外は null', () => {
    expect(takeSecToTimelineSec(shot({ sourceInSec: 1 }), 0.5, 8)).toBeNull()
    expect(takeSecToTimelineSec(shot(), 4, 8)).toBeNull()
    expect(takeSecToTimelineSec(shot(), 4.5, 8)).toBeNull()
  })
})

const event = (overrides: Partial<MotionEvent> = {}): MotionEvent => ({
  kind: 'moment',
  takeStartSec: 1,
  takeDurationSec: 0.4,
  label: '着地',
  sfxPrompt: 'cartoon boing bounce landing',
  confidence: 0.9,
  ...overrides,
})

describe('motionEventsOnTimeline', () => {
  it('出来事をタイムラインの秒に直し、映る範囲の外の瞬間は落とす', () => {
    const placed = motionEventsOnTimeline(shot({ sourceInSec: 1 }), 8, [
      event({ takeStartSec: 0.5 }),
      event({ takeStartSec: 2 }),
      event({ takeStartSec: 5.5 }),
    ])
    expect(placed.map((e) => e.startSec)).toEqual([11])
  })

  it('続く音は映る範囲に切り詰め、速さで長さも縮める', () => {
    const placed = motionEventsOnTimeline(shot({ speed: 2 }), 10, [
      event({ kind: 'sustained', takeStartSec: 6, takeDurationSec: 4, label: 'スキール' }),
    ])
    // 速さ 2 で映るのは Take の 0〜8 秒。6〜8 秒の 2 秒が、タイムラインでは 1 秒
    expect(placed).toEqual([
      expect.objectContaining({ kind: 'sustained', startSec: 13, durationSec: 1, label: 'スキール' }),
    ])
  })

  it('映る範囲と重ならない続く音は落とす', () => {
    expect(
      motionEventsOnTimeline(shot(), 8, [event({ kind: 'ambient', takeStartSec: 5, takeDurationSec: 2 })]),
    ).toEqual([])
  })
})

const timelineEvent = (overrides: Partial<TimelineMotionEvent> = {}): TimelineMotionEvent => ({
  kind: 'moment',
  startSec: 24.18,
  durationSec: 0.4,
  label: '着地',
  sfxPrompt: 'cartoon boing bounce landing',
  confidence: 0.9,
  ...overrides,
})

describe('motionEventsToSfxCues', () => {
  it('瞬間は 1 つのきっかけになり、0.5 秒未満は 0.5 秒にする', () => {
    const [cue] = motionEventsToSfxCues([timelineEvent({ durationSec: 0.2 })])
    expect(cue?.cue).toMatchObject({ startSec: 24.18, durationSec: SFX_DURATION_MIN_SEC })
    expect(cue?.kind).toBe('motion_moment')
    expect(cue?.reason).toContain('着地')
  })

  it('10 秒を超える続く音は、10 秒以内の同じ長さに分け、つなぎ目を重ねる', () => {
    const cues = motionEventsToSfxCues([timelineEvent({ kind: 'sustained', startSec: 2, durationSec: 25 })])
    expect(cues).toHaveLength(3)
    for (const c of cues) {
      expect(c.cue.durationSec).toBeLessThanOrEqual(SFX_DURATION_MAX_SEC)
      expect(SfxCue.safeParse(c.cue).success).toBe(true)
    }
    const first = cues[0]?.cue
    const last = cues[2]?.cue
    expect(first?.startSec).toBe(2)
    expect((last?.startSec ?? 0) + (last?.durationSec ?? 0)).toBeCloseTo(27)
    // 隣のきっかけと重なる長さ
    expect((first?.startSec ?? 0) + (first?.durationSec ?? 0) - (cues[1]?.cue.startSec ?? 0)).toBeCloseTo(
      MOTION_SFX_SPLIT_OVERLAP_SEC,
    )
  })

  it('ちょうど 10 秒は分けない', () => {
    expect(motionEventsToSfxCues([timelineEvent({ kind: 'sustained', durationSec: 10 })])).toHaveLength(1)
  })

  it('音の指示は出来事のものをそのまま使う', () => {
    const [cue] = motionEventsToSfxCues([timelineEvent({ sfxPrompt: 'tire screech drifting on asphalt', kind: 'sustained', durationSec: 3 })])
    expect(cue?.cue.prompt).toBe('tire screech drifting on asphalt')
  })
})

describe('suggestSfxCues に動きの出来事を混ぜる', () => {
  it('エフェクトの案と、動きの案を時刻順に並べる', () => {
    const result = suggestSfxCues({
      video1: [{ shotId: 's1', startSec: 0 }],
      transitions: [],
      clips: [{ track: 'VFX', startSec: 3, durationSec: 0.5, content: { type: 'motion_graphics', templateKey: 'flash' } }],
      motion: [timelineEvent({ startSec: 1 }), timelineEvent({ startSec: 5 })],
    })
    expect(result.map((s) => [s.kind, s.cue.startSec])).toEqual([
      ['motion_moment', 1],
      ['impact', 3],
      ['motion_moment', 5],
    ])
  })
})
