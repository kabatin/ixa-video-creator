import { describe, expect, it } from 'vitest'
import {
  TIMELINE_KEY_HELP,
  playheadLeftPx,
  resolveTimelineKey,
  seekSecAtClientX,
} from '@/lib/timeline-playhead'

/** 再生ヘッドの位置と、目盛りを押した秒、Space の行き先を固定する。 */

describe('再生ヘッドの位置', () => {
  it('秒 × 倍率で x になる', () => {
    expect(playheadLeftPx(3, 116, 40)).toBe(120)
  })

  it('曲の外は端に収める', () => {
    expect(playheadLeftPx(-5, 116, 40)).toBe(0)
    expect(playheadLeftPx(500, 116, 40)).toBe(116 * 40)
  })
})

describe('目盛りを押した秒', () => {
  const bounds = { left: 100 }

  it('要素の左端からの距離で決まる', () => {
    expect(seekSecAtClientX(100 + 80, bounds, 40, 116)).toBeCloseTo(2, 6)
  })

  it('曲の外は端に収める', () => {
    expect(seekSecAtClientX(0, bounds, 40, 116)).toBe(0)
    expect(seekSecAtClientX(100 + 99999, bounds, 40, 116)).toBe(116)
  })
})

describe('キー', () => {
  const press = (key: string, target: { tagName: string } | null = null, mods = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target,
    ...mods,
  })

  it('Space は再生 / 一時停止', () => {
    expect(resolveTimelineKey(press(' '))).toEqual({ kind: 'toggle_play' })
    expect(resolveTimelineKey(press('Spacebar'))).toEqual({ kind: 'toggle_play' })
  })

  it('入力欄への Space は横取りしない', () => {
    expect(resolveTimelineKey(press(' ', { tagName: 'INPUT' }))).toBeNull()
    expect(resolveTimelineKey(press(' ', { tagName: 'TEXTAREA' }))).toBeNull()
  })

  it('修飾キー付きは横取りしない', () => {
    expect(resolveTimelineKey(press(' ', null, { metaKey: true }))).toBeNull()
    expect(resolveTimelineKey(press(' ', null, { ctrlKey: true }))).toBeNull()
  })

  it('割り当ての無いキーは何も返さない', () => {
    expect(resolveTimelineKey(press('a'))).toBeNull()
    expect(resolveTimelineKey(press('ArrowLeft'))).toBeNull()
  })

  it('画面に出す一覧は判定と同じキーだけを持つ', () => {
    expect(TIMELINE_KEY_HELP.map((h) => h.keys)).toEqual(['Space'])
  })
})
