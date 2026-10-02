import { describe, expect, it } from 'vitest'
import {
  TIMELINE_KEY_HELP,
  followScrollLeft,
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

/**
 * 再生位置を追う（制作者 2026-10-02「タイムラインも現在位置に合わせて追従するようにしたい。他画面に合わせチェックで追従ON/OFF」）。
 * 聴きながら切ると同じ決まり: 鳴っている間は再生位置を見えている帯の真ん中に保つ。止めている間は、見えているうちは触らず、
 * 画面から出たときだけ連れ戻す。左の見出しの列（横に流れない）の分は、見えている帯から外す。
 */
describe('followScrollLeft', () => {
  // 箱の幅 600px、見出し 176px → 見えている帯は 424px。中身（見出し＋帯）は 2176px。
  const base = { viewportPx: 600, labelPx: 176, contentPx: 2000, scrollLeft: 0 }

  it('鳴っている間は、再生位置を見えている帯の真ん中に置く', () => {
    expect(followScrollLeft({ ...base, playheadPx: 1000, playing: true })).toBe(1000 - 212)
  })

  it('端では寄せすぎない（左は 0、右は中身の終わりまで）', () => {
    expect(followScrollLeft({ ...base, playheadPx: 50, playing: true, scrollLeft: 300 })).toBe(0)
    expect(followScrollLeft({ ...base, playheadPx: 1990, playing: true })).toBe(2176 - 600)
  })

  it('止めている間は、見えているうちは動かさない（自分で送った窓を引き戻さない）', () => {
    expect(followScrollLeft({ ...base, playheadPx: 300, playing: false, scrollLeft: 100 })).toBeNull()
  })

  it('止めている間でも、画面から出ていれば真ん中へ連れ戻す', () => {
    expect(followScrollLeft({ ...base, playheadPx: 1500, playing: false, scrollLeft: 0 })).toBe(1500 - 212)
  })

  it('もう真ん中にあれば動かさない（同じ値を書き続けない）', () => {
    expect(followScrollLeft({ ...base, playheadPx: 1000, playing: true, scrollLeft: 788 })).toBeNull()
  })
})
