import { describe, expect, it } from 'vitest'
import {
  ANCHOR_GRID,
  FADE_OPTIONS,
  offsetPercentLabel,
  parseOffsetPercent,
  parseSizePercent,
  readTextClipParams,
  sizePercentLabel,
  keepTextParams,
  withStyle,
} from '@/lib/text-style-form'

const STYLE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

/** テロップの見た目の欄（ADR-0028）。画面の言葉と保存する値の行き来。px は出さない。 */
describe('大きさ（画面の高さの %）', () => {
  it('空欄は自動（null）、数は割合にする', () => {
    expect(parseSizePercent('')).toEqual({ ok: true, value: null })
    expect(parseSizePercent('6')).toEqual({ ok: true, value: 0.06 })
    expect(parseSizePercent('6%')).toEqual({ ok: true, value: 0.06 })
    // 小数の割り算の端数を残さない（5.2 → 0.052000000000000005 にしない）。
    expect(parseSizePercent('5.2')).toEqual({ ok: true, value: 0.052 })
  })

  it('範囲の外（2〜20）は理由を返す', () => {
    expect(parseSizePercent('1').ok).toBe(false)
    expect(parseSizePercent('25').ok).toBe(false)
    expect(parseSizePercent('大きく').ok).toBe(false)
  })

  it('表示は % で、自動は空欄', () => {
    expect(sizePercentLabel(0.06)).toBe('6')
    expect(sizePercentLabel(0.075)).toBe('7.5')
    expect(sizePercentLabel(null)).toBe('')
  })
})

describe('ずらし（画面の幅・高さの %）', () => {
  it('-50〜50 の数を割合にする。空欄は 0', () => {
    expect(parseOffsetPercent('-10')).toEqual({ ok: true, value: -0.1 })
    expect(parseOffsetPercent('')).toEqual({ ok: true, value: 0 })
    expect(parseOffsetPercent('60').ok).toBe(false)
    expect(offsetPercentLabel(-0.1)).toBe('-10')
  })
})

describe('定位置の 3×3', () => {
  it('上から下、左から右の順に 9 か所', () => {
    expect(ANCHOR_GRID.flat().map((cell) => cell.anchor)).toEqual([
      'top-left', 'top-center', 'top-right',
      'middle-left', 'middle-center', 'middle-right',
      'bottom-left', 'bottom-center', 'bottom-right',
    ])
    expect(ANCHOR_GRID[0]?.[0]?.label).toBe('左上')
  })
})

describe('フェードの選択肢', () => {
  it('なし・0.25s〜2.00s（書式は尺と同じ）', () => {
    expect(FADE_OPTIONS.map((option) => option.label)).toEqual(['なし', '0.25s', '0.50s', '1.00s', '1.50s', '2.00s'])
  })
})

describe('見た目を 1 項目だけ変える', () => {
  it('他の項目・文字・どのスタイルからかは残す', () => {
    const params = { text: '歌詞', style: { color: '#FFD100', size: 0.05 }, styleId: STYLE_ID }
    expect(withStyle(params, { anchor: 'top-left' })).toEqual({
      text: '歌詞',
      style: { color: '#FFD100', size: 0.05, anchor: 'top-left' },
      styleId: STYLE_ID,
    })
    // 元は変えない。
    expect(params.style).toEqual({ color: '#FFD100', size: 0.05 })
  })

  it('undefined を渡した項目は消す（型の既定値に戻す）', () => {
    expect(withStyle({ text: '歌詞', style: { color: '#FFD100' } }, { color: undefined })).toEqual({
      text: '歌詞',
      style: {},
    })
  })
})

describe('readTextClipParams', () => {
  it('テロップの中身を読む。読めない見た目は空として扱う', () => {
    expect(readTextClipParams({ text: '歌詞', style: { color: 'red' } })).toEqual({ text: '歌詞', style: {}, styleId: null })
    expect(readTextClipParams({ text: '歌詞', style: { size: 0.05 }, styleId: STYLE_ID })).toEqual({
      text: '歌詞',
      style: { size: 0.05 },
      styleId: STYLE_ID,
    })
    expect(readTextClipParams({})).toBeNull()
  })
})

/**
 * タイムラインの小窓で文字を直すと、以前は `params` が `{ text }` で丸ごと置き換わり、
 * インスペクターで付けた見た目とスタイルが消えていた（ADR-0028 を作るときに見つけた）。
 */
describe('keepTextParams', () => {
  it('文字だけ新しくし、見た目とスタイルは残す', () => {
    const existing = { type: 'text' as const, templateKey: 'plain', params: { text: '古い', style: { color: '#FFD100' }, styleId: STYLE_ID } }
    expect(keepTextParams(existing, { text: '新しい' })).toEqual({ text: '新しい', style: { color: '#FFD100' }, styleId: STYLE_ID })
  })

  it('新しく置くテロップ・テロップでなかったものは、そのまま', () => {
    expect(keepTextParams(null, { text: '新しい' })).toEqual({ text: '新しい' })
    expect(keepTextParams({ type: 'motion_graphics', templateKey: 'x', params: { a: 1 } }, { text: '新しい' })).toEqual({ text: '新しい' })
  })
})
