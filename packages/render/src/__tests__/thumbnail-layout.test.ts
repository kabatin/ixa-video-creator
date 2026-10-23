import { THUMBNAIL_SIZE, ThumbnailSpec } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { TEXT_BLOCKS, coverBox, thumbnailFrameOf, thumbnailMetadata, zoomTransform } from '../compositions/thumbnail-layout.js'
import { makeDocument } from './fixtures.js'

/** サムネイルの配置の計算（ADR-0051）。画面とレンダリングが同じこの関数を通る。 */

const CENTER = { x: 0.5, y: 0.5 }

describe('coverBox', () => {
  it('同じ比の 1920×1080 はキャンバスちょうど', () => {
    expect(coverBox({ width: 1920, height: 1080 }, THUMBNAIL_SIZE, CENTER)).toEqual({
      width: 1280,
      height: 720,
      left: 0,
      top: 0,
    })
  })

  it('縦長の作品は幅を合わせ、縦のはみ出しを寄せで切る', () => {
    const box = coverBox({ width: 1080, height: 1920 }, THUMBNAIL_SIZE, CENTER)
    expect(box.width).toBe(1280)
    expect(box.height).toBe(2276)
    expect(box.top).toBe(-778)
    expect(coverBox({ width: 1080, height: 1920 }, THUMBNAIL_SIZE, { x: 0.5, y: 0 }).top).toBe(0)
    expect(coverBox({ width: 1080, height: 1920 }, THUMBNAIL_SIZE, { x: 0.5, y: 1 }).top).toBe(-1556)
  })

  it('正方形は高さを合わせ、横のはみ出しを寄せで切る', () => {
    const box = coverBox({ width: 1000, height: 1000 }, THUMBNAIL_SIZE, { x: 0, y: 0.5 })
    expect(box).toEqual({ width: 1280, height: 1280, left: 0, top: -280 })
  })

  it('覆う大きさはキャンバスより小さくならない（黒い隙間を作らない）', () => {
    const box = coverBox({ width: 1279, height: 721 }, THUMBNAIL_SIZE, CENTER)
    expect(box.width).toBeGreaterThanOrEqual(1280)
    expect(box.height).toBeGreaterThanOrEqual(720)
  })
})

describe('zoomTransform', () => {
  it('寄せの点を中心に拡大する', () => {
    expect(zoomTransform(1.5, { x: 0.25, y: 1 })).toEqual({ transform: 'scale(1.5)', transformOrigin: '25% 100%' })
  })
})

describe('thumbnailFrameOf', () => {
  const doc = { fps: 30, durationSec: 10 }

  it('秒を丸めてコマにする（画面の「いまの位置」と同じ round）', () => {
    expect(thumbnailFrameOf(1, doc)).toBe(30)
    expect(thumbnailFrameOf(1.49 / 30, doc)).toBe(1)
    expect(thumbnailFrameOf(1.51 / 30, doc)).toBe(2)
  })

  it('尺の外は端のコマ', () => {
    expect(thumbnailFrameOf(10, doc)).toBe(299)
    expect(thumbnailFrameOf(99, doc)).toBe(299)
  })
})

describe('thumbnailMetadata', () => {
  const spec = ThumbnailSpec.parse({ background: { kind: 'timeline_frame', atSec: 1 }, title: '新曲' })

  it('タイムラインのコマは fps と尺をタイムラインに合わせる（中の Sequence を切り詰めない）', () => {
    const doc = makeDocument({ durationSec: 8 })
    expect(thumbnailMetadata({ spec, source: { kind: 'timeline_frame', doc } })).toEqual({
      fps: doc.fps,
      durationInFrames: 8 * doc.fps,
      width: 1280,
      height: 720,
    })
  })

  it('画像は 1 コマ', () => {
    expect(thumbnailMetadata({ spec, source: { kind: 'image', url: 'https://media.test/a.png' } })).toMatchObject({
      durationInFrames: 1,
      width: 1280,
      height: 720,
    })
  })
})

describe('文字の塊', () => {
  it('左の配置は左の 3 分の 1 ほどに収まる（人物の側へ出ない）', () => {
    const block = TEXT_BLOCKS.middle_left
    expect(block.left + block.width).toBeLessThanOrEqual(Math.round(1280 / 3) + 40)
  })

  it('右の配置は左の鏡写し（右の 3 分の 1・右寄せ）', () => {
    const left = TEXT_BLOCKS.middle_left
    const right = TEXT_BLOCKS.middle_right
    expect(right.width).toBe(left.width)
    expect(1280 - (right.left + right.width)).toBe(left.left)
    expect(right.left).toBeGreaterThanOrEqual(1280 - Math.round(1280 / 3) - 40)
    expect(right.align).toBe('right')
  })

  it('左下は 3 マスだった頃の「下の帯」と同じ形（見た目を変えない）', () => {
    expect(TEXT_BLOCKS.bottom_left).toEqual({
      left: 64,
      top: 432,
      width: 1152,
      height: 248,
      vertical: 'end',
      align: 'left',
      accent: 'band_top',
      maxTitleSize: 110,
      maxTitleLines: 2,
      maxSubtitleLines: 2,
    })
  })

  it('上の帯は下の帯を上下に返した位置で、上に寄せる。差し色は帯の下端', () => {
    for (const align of ['left', 'center', 'right'] as const) {
      const top = TEXT_BLOCKS[`top_${align}`]
      const bottom = TEXT_BLOCKS[`bottom_${align}`]
      expect(top.top).toBe(720 - (bottom.top + bottom.height))
      expect(top.height).toBe(bottom.height)
      expect(top.vertical).toBe('start')
      expect(top.align).toBe(align)
      expect(bottom.align).toBe(align)
      expect(top.accent).toBe('band_bottom')
    }
  })

  it('どの塊もキャンバスの中', () => {
    for (const block of Object.values(TEXT_BLOCKS)) {
      expect(block.left).toBeGreaterThanOrEqual(0)
      expect(block.top).toBeGreaterThanOrEqual(0)
      expect(block.left + block.width).toBeLessThanOrEqual(1280)
      expect(block.top + block.height).toBeLessThanOrEqual(720)
    }
  })
})
