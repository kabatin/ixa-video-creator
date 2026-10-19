import { describe, expect, it } from 'vitest'
import type { MotionEvent, MotionOnset } from '../motion/motion-analysis.js'
import {
  MOTION_SNAP_WINDOW_SEC,
  detectOnsets,
  onsetsToMomentEvents,
  snapToOnsets,
  sustainedSegments,
} from '../motion/motion-onsets.js'

/** 動きの強さの山と、続く区間と、AI の時刻の寄せ方（ADR-0054 §2・§3）。 */

const HOP = 1 / 12

/** 低い底（0.01）に、指定したコマだけ高い値を立てた列。 */
const spikes = (length: number, at: Readonly<Record<number, number>>, floor = 0.01): number[] =>
  Array.from({ length }, (_, i) => at[i] ?? floor)

const event = (overrides: Partial<MotionEvent> = {}): MotionEvent => ({
  kind: 'moment',
  takeStartSec: 1,
  takeDurationSec: 0.5,
  label: '着地',
  sfxPrompt: 'soft footstep landing on wooden floor',
  confidence: 0.8,
  ...overrides,
})

describe('detectOnsets', () => {
  it('急に増えたコマを山として、時刻と相対の強さで返す', () => {
    const onsets = detectOnsets(spikes(48, { 12: 0.06, 24: 0.03, 36: 0.045 }), HOP)
    expect(onsets.map((o) => Number(o.atSec.toFixed(3)))).toEqual([1, 2, 3])
    expect(onsets.map((o) => Number(o.strength.toFixed(2)))).toEqual([1, 0.4, 0.7])
  })

  it('全体が底上げされていても（カメラが動き続ける）、前後との差で山を取る', () => {
    const onsets = detectOnsets(spikes(48, { 12: 0.09, 30: 0.09 }, 0.06), HOP)
    expect(onsets.map((o) => Number(o.atSec.toFixed(3)))).toEqual([1, 2.5])
  })

  it('最大の 2 割に満たない小さな山は捨てる', () => {
    const onsets = detectOnsets(spikes(48, { 12: 0.11, 30: 0.025 }), HOP)
    expect(onsets).toHaveLength(1)
  })

  it('0.15 秒より近い 2 つの山は強い方を残す', () => {
    // 24fps で 2 コマ（0.083 秒）離れた 2 つの山。
    const onsets = detectOnsets(spikes(96, { 24: 0.04, 25: 0.035, 26: 0.06 }), 1 / 24)
    expect(onsets.map((o) => Number(o.atSec.toFixed(3)))).toEqual([Number((26 / 24).toFixed(3))])
  })

  it('ほとんど動かない Take（ノイズだけ）では山を出さない', () => {
    expect(detectOnsets(spikes(48, { 12: 0.012 }), HOP)).toEqual([])
    expect(detectOnsets([], HOP)).toEqual([])
    expect(detectOnsets([0.5], HOP)).toEqual([])
  })

  it('コマの間隔が正でなければ投げる（秒に直せない）', () => {
    expect(() => detectOnsets([0, 0.1, 0], 0)).toThrow()
    expect(() => detectOnsets([0, 0.1, 0], Number.NaN)).toThrow()
  })
})

describe('sustainedSegments', () => {
  it('強さが閾値を超え続ける区間を返し、短すぎる区間は捨てる', () => {
    const energy = Array.from({ length: 48 }, (_, i) => (i >= 6 && i < 30 ? 0.05 : i === 40 ? 0.05 : 0.005))
    expect(sustainedSegments(energy, HOP)).toEqual([{ startSec: 0.5, endSec: 2.5 }])
  })

  it('最後まで続く区間は、列の終わりで閉じる', () => {
    const energy = Array.from({ length: 24 }, (_, i) => (i >= 12 ? 0.05 : 0.005))
    expect(sustainedSegments(energy, HOP)).toEqual([{ startSec: 1, endSec: 2 }])
  })

  it('動きが無ければ区間は無い', () => {
    expect(sustainedSegments(Array.from({ length: 24 }, () => 0), HOP)).toEqual([])
  })
})

describe('snapToOnsets', () => {
  const onsets: readonly MotionOnset[] = [
    { atSec: 1.0, strength: 1 },
    { atSec: 1.6, strength: 0.5 },
  ]

  it('瞬間の時刻を、寄せる幅の中で最も近い山に寄せる', () => {
    const snapped = snapToOnsets([event({ takeStartSec: 1.12 }), event({ takeStartSec: 1.5 })], onsets)
    expect(snapped.map((e) => e.takeStartSec)).toEqual([1.0, 1.6])
  })

  it('幅の外なら AI の時刻のまま', () => {
    const at = 1.0 + MOTION_SNAP_WINDOW_SEC + 0.01
    expect(snapToOnsets([event({ takeStartSec: at })], onsets)[0]?.takeStartSec).toBe(at)
  })

  it('続く音・通り過ぎ・環境音は寄せない', () => {
    const kept = snapToOnsets(
      [
        event({ kind: 'sustained', takeStartSec: 1.1, takeDurationSec: 2 }),
        event({ kind: 'pass_by', takeStartSec: 1.1 }),
        event({ kind: 'ambient', takeStartSec: 1.1, takeDurationSec: 3 }),
      ],
      onsets,
    )
    expect(kept.map((e) => e.takeStartSec)).toEqual([1.1, 1.1, 1.1])
  })

  it('2 つの瞬間が同じ山に寄ったら、確からしい方だけを残す', () => {
    const snapped = snapToOnsets(
      [event({ takeStartSec: 0.95, confidence: 0.4 }), event({ takeStartSec: 1.05, confidence: 0.9, label: '強い着地' })],
      onsets,
    )
    expect(snapped.map((e) => [e.takeStartSec, e.label])).toEqual([[1.0, '強い着地']])
  })

  it('元の配列を書き換えない', () => {
    const original = [event({ takeStartSec: 1.12 })]
    snapToOnsets(original, onsets)
    expect(original[0]?.takeStartSec).toBe(1.12)
  })
})

describe('onsetsToMomentEvents', () => {
  it('AI で見ていないときは、山をそのまま「瞬間」の案にする', () => {
    const events = onsetsToMomentEvents([{ atSec: 0.5, strength: 0.7 }])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'moment', takeStartSec: 0.5, confidence: 0.7 })
    expect(events[0]?.label).toBe('動きの山')
  })
})
