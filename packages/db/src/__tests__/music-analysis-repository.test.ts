import { describe, expect, it } from 'vitest'
import {
  CreateMusicAnalysisInput,
  MANUAL_ANALYZER_VERSION,
  MusicAnalysisId,
  MusicTrackId,
  newId,
} from '@ixa/domain'
import type { MusicAnalysisRow } from '../repositories/music-analysis-repository.js'
import { musicAnalysisRowToDomain } from '../repositories/music-analysis-repository.js'

const baseRow = (): MusicAnalysisRow => ({
  id: newId(MusicAnalysisId),
  musicTrackId: newId(MusicTrackId),
  analyzerVersion: 'librosa-v1',
  durationSec: 116,
  bpm: 119.9984,
  bpmConfidence: 0.92,
  beats: [0, 0.5, 1],
  downbeats: [0, 2],
  sections: [{ start: 0, end: 116, label: 'intro', energy: 0.4 }],
  energyCurve: { hopSec: 0.05, values: [0, 0.5, 1] },
  onsets: [0.01, 0.51],
  drops: [32.5],
  waveformPeaksKey: 'music/p/t/peaks.json',
  createdAt: new Date('2026-09-16T00:00:00Z'),
})

describe('musicAnalysisRowToDomain', () => {
  it('row を MusicAnalysis に変換する', () => {
    const row = baseRow()
    const analysis = musicAnalysisRowToDomain(row)
    expect(analysis.id).toBe(row.id)
    expect(analysis.musicTrackId).toBe(row.musicTrackId)
    expect(analysis.analyzerVersion).toBe('librosa-v1')
    expect(analysis.durationSec).toBe(116)
    expect(analysis.energyCurve).toEqual(row.energyCurve)
    expect(analysis.sections).toEqual(row.sections)
    expect(analysis.createdAt).toEqual(row.createdAt)
  })

  it('手動補正のバージョンも解析器バージョンとして受け入れる', () => {
    const analysis = musicAnalysisRowToDomain({
      ...baseRow(),
      analyzerVersion: MANUAL_ANALYZER_VERSION,
    })
    expect(analysis.analyzerVersion).toBe(MANUAL_ANALYZER_VERSION)
  })

  it('JSONB が壊れている行は投げる（黙って既定値で埋めない）', () => {
    const row = {
      ...baseRow(),
      sections: [{ start: 0, end: 1, label: 'unknown_label', energy: 0.1 }],
    } as unknown as MusicAnalysisRow
    expect(() => musicAnalysisRowToDomain(row)).toThrow()
  })

  it('bpm が 0 以下の行は投げる', () => {
    expect(() => musicAnalysisRowToDomain({ ...baseRow(), bpm: 0 })).toThrow()
  })

  it('analyzerVersion が空の行は投げる', () => {
    expect(() => musicAnalysisRowToDomain({ ...baseRow(), analyzerVersion: '' })).toThrow()
  })
})

describe('CreateMusicAnalysisInput', () => {
  /** row から入力候補を作る。id / createdAt は敢えて残し、strip されることを確かめる。 */
  const inputCandidate = (): Record<string, unknown> => ({ ...baseRow() })

  it('id と createdAt を捨てる（どちらも永続化側が採番するため）', () => {
    const candidate = inputCandidate()
    const parsed = CreateMusicAnalysisInput.parse(candidate)
    expect('id' in parsed).toBe(false)
    expect('createdAt' in parsed).toBe(false)
    expect(parsed.musicTrackId).toBe(candidate.musicTrackId)
  })

  it('musicTrackId が欠けていれば投げる', () => {
    const candidate = inputCandidate()
    delete candidate.musicTrackId
    expect(() => CreateMusicAnalysisInput.parse(candidate)).toThrow()
  })
})
