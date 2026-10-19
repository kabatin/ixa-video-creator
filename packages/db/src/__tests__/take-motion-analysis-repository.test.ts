import { describe, expect, it } from 'vitest'
import { MOTION_ANALYZER_VERSION, newId, TakeId, TakeMotionAnalysisId } from '@ixa/domain'
import {
  takeMotionAnalysisRowToDomain,
  type TakeMotionAnalysisRow,
} from '../repositories/take-motion-analysis-repository.js'

const baseRow = (): TakeMotionAnalysisRow => ({
  id: newId(TakeMotionAnalysisId),
  takeId: newId(TakeId),
  analyzerVersion: MOTION_ANALYZER_VERSION,
  status: 'succeeded',
  energyHopSec: 1 / 12,
  energy: [0, 0.03, 0.06],
  onsets: [{ atSec: 0.1667, strength: 1 }],
  events: [
    {
      kind: 'moment',
      takeStartSec: 0.1667,
      takeDurationSec: 0.4,
      label: '着地',
      sfxPrompt: 'cartoon boing bounce landing',
      confidence: 0.9,
    },
  ],
  visionUsed: true,
  costUsd: 0.05,
  failureMessage: null,
  createdAt: new Date('2026-10-19T00:00:00Z'),
})

describe('takeMotionAnalysisRowToDomain', () => {
  it('row を MotionAnalysis に変換する', () => {
    const row = baseRow()
    const analysis = takeMotionAnalysisRowToDomain(row)
    expect(analysis.takeId).toBe(row.takeId)
    expect(analysis.events).toEqual(row.events)
    expect(analysis.onsets).toEqual(row.onsets)
    expect(analysis.visionUsed).toBe(true)
  })

  it('JSONB の出来事が壊れている行は投げる（黙って既定値で埋めない）', () => {
    const row = { ...baseRow(), events: [{ kind: 'explosion' }] } as unknown as TakeMotionAnalysisRow
    expect(() => takeMotionAnalysisRowToDomain(row)).toThrow()
  })

  it('理由の無い失敗の行は投げる', () => {
    expect(() => takeMotionAnalysisRowToDomain({ ...baseRow(), status: 'failed' })).toThrow()
  })
})
