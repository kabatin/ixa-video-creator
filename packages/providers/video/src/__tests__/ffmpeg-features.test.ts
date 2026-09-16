import { describe, expect, it } from 'vitest'
import { hasDrawtext, hasFilter, isForcedNoDrawtext } from '../stub/ffmpeg-features.js'

/** Homebrew の ffmpeg-full 9.0.1 の実出力から抜粋。 */
const WITH_DRAWTEXT = `Filters:
  T. drawgraph          V->V       Draw a graph using input video metadata.
  T. drawtext           V->V       Draw text on top of video frames using libfreetype library.
  TS noise              V->V       Add noise.
`

/** Homebrew の ffmpeg 8.0.1（libfreetype 無しビルド）の実出力から抜粋。 */
const WITHOUT_DRAWTEXT = `Filters:
  ... drawbox           V->V       Draw a colored box on the input video.
  T. drawgrid           V->V       Draw a colored grid on the input video.
  TS noise              V->V       Add noise.
`

/** 説明文に filter 名が現れるケース。2 列目だけを見ないと誤検知する。 */
const MENTIONED_IN_DESCRIPTION = `Filters:
  .. subtitles          V->V       Render subtitles onto input video using drawtext internals.
`

describe('hasDrawtext', () => {
  it('drawtext を含むビルドを検出する', () => {
    expect(hasDrawtext(WITH_DRAWTEXT)).toBe(true)
  })

  it('drawtext を含まないビルドを検出する', () => {
    expect(hasDrawtext(WITHOUT_DRAWTEXT)).toBe(false)
  })

  it('説明文中の drawtext を誤検知しない', () => {
    expect(hasDrawtext(MENTIONED_IN_DESCRIPTION)).toBe(false)
  })

  it('空文字でも落ちない', () => {
    expect(hasDrawtext('')).toBe(false)
  })
})

describe('hasFilter', () => {
  it('任意のフィルタ名を判定できる', () => {
    expect(hasFilter(WITHOUT_DRAWTEXT, 'drawbox')).toBe(true)
    expect(hasFilter(WITHOUT_DRAWTEXT, 'noise')).toBe(true)
    expect(hasFilter(WITHOUT_DRAWTEXT, 'drawtext')).toBe(false)
  })

  it('前方一致では拾わない', () => {
    expect(hasFilter(WITHOUT_DRAWTEXT, 'draw')).toBe(false)
  })
})

describe('isForcedNoDrawtext', () => {
  it('未設定・空・0・false は強制しない', () => {
    expect(isForcedNoDrawtext(undefined)).toBe(false)
    expect(isForcedNoDrawtext('')).toBe(false)
    expect(isForcedNoDrawtext('0')).toBe(false)
    expect(isForcedNoDrawtext('false')).toBe(false)
    expect(isForcedNoDrawtext('False')).toBe(false)
  })

  it('それ以外の値は強制縮退とみなす', () => {
    expect(isForcedNoDrawtext('1')).toBe(true)
    expect(isForcedNoDrawtext('true')).toBe(true)
    expect(isForcedNoDrawtext('yes')).toBe(true)
  })
})
