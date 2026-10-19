import { describe, expect, it } from 'vitest'
import { newId, TakeId, TakeMotionAnalysisId } from '../common/ids.js'
import {
  MOTION_ANALYZER_VERSION,
  MOTION_EVENTS_MAX,
  MOTION_EVENT_LABEL_MAX_LENGTH,
  MotionAnalysis,
  MotionEvent,
  fitEventsToTake,
  needsMotionAnalysis,
} from '../motion/motion-analysis.js'

/** 動きの分析の形（ADR-0054 §1・§3）。範囲を破る値は弾く。 */

const validEvent = {
  kind: 'moment',
  takeStartSec: 1.2,
  takeDurationSec: 0.4,
  label: '着地',
  sfxPrompt: 'cartoon boing bounce landing',
  confidence: 0.9,
}

const validAnalysis = () => ({
  id: newId(TakeMotionAnalysisId),
  takeId: newId(TakeId),
  analyzerVersion: MOTION_ANALYZER_VERSION,
  status: 'succeeded',
  energyHopSec: 1 / 12,
  energy: [0, 0.02, 0.05],
  onsets: [{ atSec: 0.1667, strength: 1 }],
  events: [validEvent],
  visionUsed: true,
  costUsd: 0.04,
  failureMessage: null,
  createdAt: new Date(),
})

describe('MotionEvent', () => {
  it('正しい出来事を通す', () => {
    expect(MotionEvent.parse(validEvent)).toMatchObject({ kind: 'moment', label: '着地' })
  })

  it.each([
    ['知らない種類', { kind: 'explosion' }],
    ['負の時刻', { takeStartSec: -0.1 }],
    ['負の長さ', { takeDurationSec: -1 }],
    ['空の名前', { label: '  ' }],
    ['長すぎる名前', { label: 'あ'.repeat(MOTION_EVENT_LABEL_MAX_LENGTH + 1) }],
    ['日本語の音の指示', { sfxPrompt: '足音' }],
    ['確からしさが 1 を超える', { confidence: 1.1 }],
    ['確からしさが負', { confidence: -0.1 }],
  ])('%s は弾く', (_, override) => {
    expect(MotionEvent.safeParse({ ...validEvent, ...override }).success).toBe(false)
  })
})

describe('MotionAnalysis', () => {
  it('成功した分析を通す', () => {
    expect(MotionAnalysis.parse(validAnalysis()).status).toBe('succeeded')
  })

  it('失敗の行は理由が要る。成功の行は理由を持たない', () => {
    expect(MotionAnalysis.safeParse({ ...validAnalysis(), status: 'failed', failureMessage: null }).success).toBe(false)
    expect(
      MotionAnalysis.safeParse({ ...validAnalysis(), status: 'failed', failureMessage: '動画が見つかりませんでした。' })
        .success,
    ).toBe(true)
    expect(MotionAnalysis.safeParse({ ...validAnalysis(), failureMessage: '何か' }).success).toBe(false)
  })

  it.each([
    ['間隔が 0', { energyHopSec: 0 }],
    ['強さが 1 を超える', { energy: [0, 1.5] }],
    ['強さが負', { energy: [-0.1] }],
    ['山の強さが 1 を超える', { onsets: [{ atSec: 0.1, strength: 2 }] }],
    ['出来事が多すぎる', { events: Array.from({ length: MOTION_EVENTS_MAX + 1 }, () => validEvent) }],
    ['負の費用', { costUsd: -0.01 }],
  ])('%s は弾く', (_, override) => {
    expect(MotionAnalysis.safeParse({ ...validAnalysis(), ...override }).success).toBe(false)
  })
})

describe('fitEventsToTake', () => {
  it('Take の外で始まる出来事は落とし、はみ出す長さは Take の終わりで切る', () => {
    const fitted = fitEventsToTake(
      [
        { ...validEvent, kind: 'moment', takeStartSec: 4.9 },
        { ...validEvent, kind: 'sustained', takeStartSec: 3, takeDurationSec: 5 },
        { ...validEvent, kind: 'moment', takeStartSec: 5 },
      ] as MotionEvent[],
      5,
    )
    expect(fitted.map((e) => [e.kind, e.takeStartSec, Number(e.takeDurationSec.toFixed(3))])).toEqual([
      ['sustained', 3, 2],
      ['moment', 4.9, 0.1],
    ])
  })
})

describe('needsMotionAnalysis', () => {
  const done = (visionUsed: boolean) => ({
    analyzerVersion: MOTION_ANALYZER_VERSION,
    status: 'succeeded' as const,
    visionUsed,
  })

  it('まだ分析していなければ分析する', () => {
    expect(needsMotionAnalysis(null, { visionAvailable: true })).toBe(true)
  })

  it('同じ版で成功していれば作り直さない', () => {
    expect(needsMotionAnalysis(done(true), { visionAvailable: true })).toBe(false)
    expect(needsMotionAnalysis(done(false), { visionAvailable: false })).toBe(false)
  })

  it('AI で見ていない結果は、Claude を選んだら作り直す', () => {
    expect(needsMotionAnalysis(done(false), { visionAvailable: true })).toBe(true)
  })

  it('失敗した行や、古い版の行なら作り直す', () => {
    expect(needsMotionAnalysis({ ...done(true), status: 'failed' }, { visionAvailable: true })).toBe(true)
    expect(needsMotionAnalysis({ ...done(true), analyzerVersion: 'motion-v0' }, { visionAvailable: true })).toBe(true)
  })
})
