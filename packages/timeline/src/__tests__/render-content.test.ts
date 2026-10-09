import { describe, expect, it } from 'vitest'
import { renderContentKey } from '../render-content.js'

/** 制作者 2026-10-09。同じ書き出しを、書き出す前に見分ける。 */
describe('renderContentKey', () => {
  it('署名付き URL の署名と期限だけが違うものは同じ', () => {
    const a = { video1: [{ mediaUrl: 'http://h:3001/files/media/a.mp4?expires=1&sig=x' }] }
    const b = { video1: [{ mediaUrl: 'http://h:3001/files/media/a.mp4?expires=2&sig=y' }] }
    expect(renderContentKey(a)).toBe(renderContentKey(b))
  })

  it('素材が違えば違う', () => {
    const a = { video1: [{ mediaUrl: 'http://h:3001/files/media/a.mp4?sig=x' }] }
    const b = { video1: [{ mediaUrl: 'http://h:3001/files/media/b.mp4?sig=x' }] }
    expect(renderContentKey(a)).not.toBe(renderContentKey(b))
  })

  it('鍵の順が違っても同じ（DB から読むと順が変わる）', () => {
    expect(renderContentKey({ fps: 24, durationSec: 3 })).toBe(renderContentKey({ durationSec: 3, fps: 24 }))
  })

  it('並び・数・文字が 1 つでも違えば違う', () => {
    expect(renderContentKey({ clips: [1, 2] })).not.toBe(renderContentKey({ clips: [2, 1] }))
    expect(renderContentKey({ durationSec: 3 })).not.toBe(renderContentKey({ durationSec: 3.001 }))
    expect(renderContentKey({ text: 'こんにちは' })).not.toBe(renderContentKey({ text: 'こんばんは' }))
  })

  it('URL でない文字列の ? は落とさない（テロップの文字など）', () => {
    expect(renderContentKey({ text: '本当？' })).not.toBe(renderContentKey({ text: '本当' }))
  })
})
