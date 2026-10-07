import { describe, expect, it } from 'vitest'
import {
  contentRangeHeader,
  parseByteRange,
  rangeLength,
  unsatisfiedRangeHeader,
} from '../files/byte-range.js'

/**
 * `Range` の読み取り（ADR-0041）。
 *
 * MinIO が返していた部分応答を自分で書くことになるので、**境目をここで固定する。**
 * ここが違うと、動画は「再生できる」のにシークだけが壊れる（気付きにくい）。
 */

const SIZE = 1000

describe('parseByteRange', () => {
  it.each([
    { name: '無い', header: undefined },
    { name: '空', header: '   ' },
    { name: '単位が違う', header: 'items=0-10' },
    { name: '複数の範囲（扱わない）', header: 'bytes=0-10, 20-30' },
    { name: '逆向き', header: 'bytes=500-100' },
    { name: '数字でない', header: 'bytes=abc-def' },
    { name: 'どちらも空', header: 'bytes=-' },
  ])('$name Range は全体を返す', ({ header }) => {
    expect(parseByteRange(header, SIZE)).toEqual({ kind: 'full' })
  })

  /** Safari は再生の前にこれを投げる。ここを 206 で返せないと再生が始まらない。 */
  it('頭の 2 バイトだけ（bytes=0-1）', () => {
    expect(parseByteRange('bytes=0-1', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 1 },
    })
  })

  it('途中から最後まで（bytes=500-）', () => {
    expect(parseByteRange('bytes=500-', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 500, end: 999 },
    })
  })

  it('末尾から数える（bytes=-100）', () => {
    expect(parseByteRange('bytes=-100', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 900, end: 999 },
    })
  })

  it('末尾から数える指定が大きさを超えたら先頭から', () => {
    expect(parseByteRange('bytes=-5000', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 999 },
    })
  })

  it('終わりが大きさを超えたら末尾までに縮める', () => {
    expect(parseByteRange('bytes=900-5000', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 900, end: 999 },
    })
  })

  it('最後の 1 バイト（境目）', () => {
    expect(parseByteRange('bytes=999-999', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 999, end: 999 },
    })
  })

  it.each([
    { name: '大きさと同じ位置から', header: 'bytes=1000-' },
    { name: '大きさを超えた位置から', header: 'bytes=1500-1600' },
    { name: '末尾から 0 バイト', header: 'bytes=-0' },
  ])('$name は満たせない（416）', ({ header }) => {
    expect(parseByteRange(header, SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  it('空のファイルはどの範囲も満たせない', () => {
    expect(parseByteRange('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable' })
    expect(parseByteRange(undefined, 0)).toEqual({ kind: 'full' })
  })

  it('大文字でも読む', () => {
    expect(parseByteRange('BYTES=0-1', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 1 },
    })
  })
})

describe('返すヘッダ', () => {
  it('206 の Content-Range', () => {
    expect(contentRangeHeader({ start: 0, end: 1 }, SIZE)).toBe('bytes 0-1/1000')
  })

  it('416 の Content-Range は満たせる大きさだけを伝える', () => {
    expect(unsatisfiedRangeHeader(SIZE)).toBe('bytes */1000')
  })

  it('返すバイト数は両端を含む', () => {
    expect(rangeLength({ start: 0, end: 0 })).toBe(1)
    expect(rangeLength({ start: 10, end: 19 })).toBe(10)
  })
})
