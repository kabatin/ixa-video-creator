import { describe, expect, it } from 'vitest'
import type { WireShotMotion } from '@/lib/motion-api'
import { motionMarksOf } from '@/lib/timeline-motion-marks'

/** タイムラインの効果音の段の上に薄く出す、分析した出来事の印（ADR-0054）。 */

const motion = (state: WireShotMotion['state'], events: WireShotMotion['events']): WireShotMotion => ({
  shotId: 's',
  takeId: 't',
  state,
  failureMessage: null,
  visionUsed: true,
  energy: null,
  onsets: [],
  events,
  suggestions: [],
})

const event = (startSec: number, label = '着地', kind: WireShotMotion['events'][number]['kind'] = 'moment') => ({
  kind,
  startSec,
  durationSec: 0.4,
  label,
  sfxPrompt: 'soft footstep',
  confidence: 0.9,
})

describe('motionMarksOf', () => {
  it('Shot ごとの出来事を、時刻順の 1 列の印にする', () => {
    const marks = motionMarksOf([motion('succeeded', [event(25), event(24)]), motion('succeeded', [event(10, 'スキール', 'sustained')])])
    expect(marks.map((m) => [m.atSec, m.label])).toEqual([
      [10, 'スキール'],
      [24, '着地'],
      [25, '着地'],
    ])
  })

  it('作り直し中・失敗でも、前に成功した出来事は印に出す（無いものは出さない）', () => {
    expect(motionMarksOf([motion('running', [event(3)]), motion('none', [])])).toHaveLength(1)
  })

  it('印の説明は時計形式の時刻と名前', () => {
    expect(motionMarksOf([motion('succeeded', [event(24.72)])])[0]?.title).toBe('0:24.72 着地（押すとここから再生）')
  })

  it('同じ時刻の印は 1 つにまとめる', () => {
    expect(motionMarksOf([motion('succeeded', [event(5), event(5, '衝撃')])])).toHaveLength(1)
  })
})
