import { describe, expect, it } from 'vitest'
import {
  FORCE_NO_DRAWTEXT_ENV, escapeDrawtextExpression, escapeDrawtextText,
  escapeForFilterArgs, escapeForFilterGraph, escapeForTextExpansion,
  hasDrawtext, hasFilter, isForcedNoDrawtext,
} from '../drawtext.js'

const WITH_DRAWTEXT = ` ... drawbox           V->V       Draw a colored box.
 T.. drawtext          V->V       Draw text on top of video frames.
 ... edgedetect        V->V       Detect and draw edge.`

const WITHOUT_DRAWTEXT = ` ... drawbox           V->V       Draw a colored box.
 ... edgedetect        V->V       Detect and draw edge.`

const MENTIONED_IN_DESCRIPTION = ` ... subtitles         V->V       Render text subtitles like drawtext does.`

describe('hasFilter / hasDrawtext', () => {
  it('フィルタ名の列だけを見る', () => {
    expect(hasDrawtext(WITH_DRAWTEXT)).toBe(true)
    expect(hasDrawtext(WITHOUT_DRAWTEXT)).toBe(false)
  })

  it('説明文に名前が出てきても誤検知しない', () => {
    expect(hasDrawtext(MENTIONED_IN_DESCRIPTION)).toBe(false)
  })

  it('任意のフィルタを判定できる', () => {
    expect(hasFilter(WITH_DRAWTEXT, 'drawbox')).toBe(true)
    expect(hasFilter(WITH_DRAWTEXT, 'nonexistent')).toBe(false)
  })
})

describe('isForcedNoDrawtext', () => {
  it('未設定・空・0・false は強制しない', () => {
    expect(isForcedNoDrawtext(undefined)).toBe(false)
    expect(isForcedNoDrawtext('')).toBe(false)
    expect(isForcedNoDrawtext('0')).toBe(false)
    expect(isForcedNoDrawtext('False')).toBe(false)
  })

  it('それ以外の値は強制縮退とみなす', () => {
    expect(isForcedNoDrawtext('1')).toBe(true)
    expect(isForcedNoDrawtext('yes')).toBe(true)
  })

  it('環境オブジェクトでも受け付ける', () => {
    expect(isForcedNoDrawtext({ [FORCE_NO_DRAWTEXT_ENV]: '1' })).toBe(true)
    expect(isForcedNoDrawtext({})).toBe(false)
  })
})

describe('エスケープ（実 ffmpeg で剥がれ方を実測した規則）', () => {
  it('展開レベルは % とバックスラッシュを保護する', () => {
    expect(escapeForTextExpansion('100%')).toBe('100\\%')
    expect(escapeForTextExpansion('a\\b')).toBe('a\\\\b')
  })

  it('filter 引数レベルは : = \' バックスラッシュを保護する', () => {
    expect(escapeForFilterArgs('a:b')).toBe('a\\:b')
    expect(escapeForFilterArgs('a=b')).toBe('a\\=b')
    expect(escapeForFilterArgs("it's")).toBe("it\\'s")
  })

  it('filtergraph レベルは , ; [ ] \' バックスラッシュを保護する', () => {
    expect(escapeForFilterGraph('a,b')).toBe('a\\,b')
    expect(escapeForFilterGraph('[x]')).toBe('\\[x\\]')
  })

  it('3 段すべてを内側から適用する', () => {
    // % は展開レベルでエスケープされ、その \ が外側 2 段でさらに保護される
    const escaped = escapeDrawtextText('100%')
    expect(escaped).toContain('%')
    expect(escaped.length).toBeGreaterThan('100%'.length)
  })

  it('展開式は展開レベルを飛ばす（%{pts} が生きたまま届く）', () => {
    const escaped = escapeDrawtextExpression('%{pts\\:hms}')
    expect(escaped).toContain('%{pts')
  })

  it('日本語をそのまま通す', () => {
    expect(escapeDrawtextText('勝利')).toBe('勝利')
  })
})
