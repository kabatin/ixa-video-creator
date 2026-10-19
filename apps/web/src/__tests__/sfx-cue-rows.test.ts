import { describe, expect, it } from 'vitest'
import { blankCueRow, cueRowsFromSuggestions, parseClock, validateCueRows, type SfxCueRow } from '@/lib/sfx-cue-rows'

/** 「効果音を作る」窓の行（ADR-0054）。案から行を作り、直した行をきっかけに戻す。 */

const suggestion = (startSec: number, kind = 'motion_moment', prompt = 'soft footstep on tile') => ({
  kind,
  reason: '動き: 着地',
  cue: { startSec, durationSec: 0.5, prompt, volume: 0.8 },
})

describe('parseClock', () => {
  it.each([
    ['0:24.72', 24.72],
    ['1:02.50', 62.5],
    ['24.72', 24.72],
    [' 0:03 ', 3],
  ])('%s は %d 秒', (text, sec) => {
    expect(parseClock(text)).toBeCloseTo(sec)
  })

  it.each(['', 'abc', '1:75.00', '-1', '0:-3'])('%s は読めない（null）', (text) => {
    expect(parseClock(text)).toBeNull()
  })
})

describe('cueRowsFromSuggestions', () => {
  it('案を時計形式の時刻の行にし、全部にチェックを付ける', () => {
    const rows = cueRowsFromSuggestions([suggestion(24.72)])
    expect(rows[0]).toMatchObject({ checked: true, start: '0:24.72', duration: '0.50', prompt: 'soft footstep on tile', volume: '0.8', reason: '動き: 着地' })
  })

  it('環境音はチェックを外して並べる（下に敷く音は選んで足す）', () => {
    expect(cueRowsFromSuggestions([suggestion(1, 'motion_ambient')])[0]?.checked).toBe(false)
  })

  it('行ごとに違う id を持つ', () => {
    const rows = cueRowsFromSuggestions([suggestion(1), suggestion(2)])
    expect(new Set(rows.map((r) => r.id)).size).toBe(2)
  })
})

describe('validateCueRows', () => {
  const [base] = cueRowsFromSuggestions([suggestion(24.72)])
  if (base === undefined) throw new Error('案から行ができませんでした')
  const row = (patch: Partial<SfxCueRow> = {}): SfxCueRow => ({ ...base, ...patch })

  it('チェックした行だけをきっかけにする', () => {
    const result = validateCueRows([row(), row({ id: 'b', checked: false, start: '0:30.00' })])
    expect(result).toEqual({ ok: true, cues: [{ startSec: 24.72, durationSec: 0.5, prompt: 'soft footstep on tile', volume: 0.8 }] })
  })

  it('1 つもチェックが無ければ断る', () => {
    const result = validateCueRows([row({ checked: false })])
    expect(result.ok).toBe(false)
  })

  it.each([
    ['読めない時刻', { start: 'abc' }],
    ['短すぎる長さ', { duration: '0.1' }],
    ['長すぎる長さ', { duration: '12' }],
    ['日本語の指示', { prompt: '足音' }],
    ['空の指示', { prompt: '' }],
    ['大きすぎる音量', { volume: '3' }],
  ])('%s はその行に理由を付けて断る', (_, patch) => {
    const result = validateCueRows([row(patch)])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[row().id]).toBeTruthy()
  })
})

describe('blankCueRow', () => {
  it('指定の時刻で、チェックを付けた空の行を作る', () => {
    expect(blankCueRow(3.5)).toMatchObject({ checked: true, start: '0:03.50', prompt: '' })
  })
})
