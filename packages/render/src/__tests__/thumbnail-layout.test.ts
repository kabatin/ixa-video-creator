import { THUMBNAIL_SIZE, ThumbnailSpec } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  MIN_TITLE_SIZE,
  TEXT_BLOCKS,
  coverBox,
  subtitleFontSize,
  textWidthEm,
  thumbnailFrameOf,
  thumbnailMetadata,
  titleFontSize,
  zoomTransform,
} from '../compositions/thumbnail-layout.js'
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

describe('題名の大きさ', () => {
  it('半角は全角の 6 割で数える', () => {
    expect(textWidthEm('ab')).toBeCloseTo(1.2)
    expect(textWidthEm('新曲')).toBe(2)
  })

  it('短い題名は配置の上限まで大きい', () => {
    expect(titleFontSize('新曲', 'center')).toBe(TEXT_BLOCKS.center.maxTitleSize)
    expect(titleFontSize('新曲', 'left')).toBe(TEXT_BLOCKS.left.maxTitleSize)
  })

  it('長い題名ほど小さくし、行数 × 幅に収める', () => {
    const long = 'あ'.repeat(30)
    const size = titleFontSize(long, 'center')
    expect(size).toBeLessThan(TEXT_BLOCKS.center.maxTitleSize)
    expect(size * 30).toBeLessThanOrEqual(TEXT_BLOCKS.center.width * TEXT_BLOCKS.center.maxTitleLines)
  })

  it('40 字でも下限より小さくしない', () => {
    expect(titleFontSize('あ'.repeat(40), 'left')).toBe(MIN_TITLE_SIZE)
  })

  it('副題は題名の約 4 割で、28〜48 に挟む', () => {
    expect(subtitleFontSize(100)).toBe(40)
    expect(subtitleFontSize(44)).toBe(28)
    expect(subtitleFontSize(150)).toBe(48)
  })

  it('左の配置は左の 3 分の 1 ほどに収まる（人物の側へ出ない）', () => {
    const block = TEXT_BLOCKS.left
    expect(block.left + block.width).toBeLessThanOrEqual(Math.round(1280 / 3) + 40)
  })
})
