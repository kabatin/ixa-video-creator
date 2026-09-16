import { describe, expect, it } from 'vitest'
import { allocateShots } from '../storyboard/shot-allocation.js'
import type { Seconds } from '../common/time.js'

/**
 * Shot 割り（ADR-0017）。**この不変条件が崩れるとタイムラインに隙間や重なりが出る。**
 * 隙間は書き出した MP4 で黒画面になり、重なりは Shot の順序が壊れる。
 */

/** BPM 120（0.5 秒間隔）のビートを count 個。 */
const beatsAt120 = (count: number): readonly Seconds[] =>
  Array.from({ length: count }, (_, index) => index * 0.5)

const endOf = (slot: { startSec: number; durationSec: number }): number =>
  slot.startSec + slot.durationSec

describe('allocateShots', () => {
  it('要求した数のスロットを返す', () => {
    const result = allocateShots({
      sectionStartSec: 0,
      sectionEndSec: 8,
      beats: beatsAt120(17),
      subdivision: 1,
      requestedCount: 4,
    })

    expect(result.slots).toHaveLength(4)
    expect(result.reducedReason).toBeNull()
  })

  it('隣り合うスロットに隙間も重なりも無い', () => {
    const { slots } = allocateShots({
      sectionStartSec: 0,
      sectionEndSec: 8,
      beats: beatsAt120(17),
      subdivision: 1,
      requestedCount: 5,
    })

    for (let i = 0; i + 1 < slots.length; i += 1) {
      // 隙間があれば黒画面、重なれば順序が壊れる。どちらも許さない。
      expect(endOf(slots[i] as ShotSlotLike)).toBe((slots[i + 1] as ShotSlotLike).startSec)
    }
  })

  it('全体がセクションをちょうど覆う', () => {
    const { slots } = allocateShots({
      sectionStartSec: 2,
      sectionEndSec: 10,
      beats: beatsAt120(25),
      subdivision: 1,
      requestedCount: 3,
    })

    expect((slots[0] as ShotSlotLike).startSec).toBe(2)
    expect(endOf(slots[slots.length - 1] as ShotSlotLike)).toBe(10)
  })

  it('尺 0 のスロットを作らない', () => {
    const { slots } = allocateShots({
      sectionStartSec: 0,
      sectionEndSec: 4,
      beats: beatsAt120(9),
      subdivision: 1,
      requestedCount: 8,
    })

    expect(slots.every((slot) => slot.durationSec > 0)).toBe(true)
  })

  it('グリッドが支えられなければ数を減らし、理由を返す（ADR-0017）', () => {
    // 0〜4 秒に拍は 9 個（両端含む）。境界が 9 個なので上限は 8 カット。
    const result = allocateShots({
      sectionStartSec: 0,
      sectionEndSec: 4,
      beats: beatsAt120(9),
      subdivision: 1,
      requestedCount: 20,
    })

    expect(result.slots.length).toBeLessThan(20)
    expect(result.requestedCount).toBe(20)
    // 黙って減らさない。呼び出し側が warning として出せるよう理由を返す。
    expect(result.reducedReason).toContain('上限')
  })

  it('減らしていないときは reducedReason が null', () => {
    const result = allocateShots({
      sectionStartSec: 0,
      sectionEndSec: 8,
      beats: beatsAt120(17),
      subdivision: 1,
      requestedCount: 2,
    })

    expect(result.reducedReason).toBeNull()
  })

  it('スロットの境界はビートの上にある', () => {
    const beats = beatsAt120(17)
    const { slots } = allocateShots({
      sectionStartSec: 0,
      sectionEndSec: 8,
      beats,
      subdivision: 1,
      requestedCount: 4,
    })

    for (const slot of slots) {
      expect(beats).toContain(slot.startSec)
      expect(beats).toContain(endOf(slot))
    }
  })

  it('端がビートから外れていてもグリッドへ寄せてから割る', () => {
    const beats = beatsAt120(17)
    const { slots } = allocateShots({
      sectionStartSec: 0.2,
      sectionEndSec: 7.9,
      beats,
      subdivision: 1,
      requestedCount: 2,
    })

    // 先に寄せないと最初と最後の Shot だけ拍から外れる。
    expect((slots[0] as ShotSlotLike).startSec).toBe(0)
    expect(endOf(slots[slots.length - 1] as ShotSlotLike)).toBe(8)
  })

  it('ビートが無ければ等分する（解析前でも試せるように）', () => {
    const { slots } = allocateShots({
      sectionStartSec: 0,
      sectionEndSec: 9,
      beats: [],
      subdivision: 1,
      requestedCount: 3,
    })

    expect(slots).toHaveLength(3)
    expect(slots.map((slot) => slot.durationSec)).toEqual([3, 3, 3])
  })

  it('subdivision を細かくすると上限が増える', () => {
    const beats = beatsAt120(9)
    const coarse = allocateShots({
      sectionStartSec: 0, sectionEndSec: 4, beats, subdivision: 1, requestedCount: 100,
    })
    const fine = allocateShots({
      sectionStartSec: 0, sectionEndSec: 4, beats, subdivision: 0.25, requestedCount: 100,
    })

    expect(fine.slots.length).toBeGreaterThan(coarse.slots.length)
  })

  it('同じ入力で必ず同じ結果になる（再現性）', () => {
    const input = {
      sectionStartSec: 1.3,
      sectionEndSec: 9.7,
      beats: beatsAt120(25),
      subdivision: 0.5 as const,
      requestedCount: 7,
    }
    const runs = Array.from({ length: 5 }, () => JSON.stringify(allocateShots(input).slots))

    expect(new Set(runs).size).toBe(1)
  })

  it('カット数が 1 以上の整数でなければ例外', () => {
    const base = {
      sectionStartSec: 0, sectionEndSec: 8, beats: beatsAt120(17), subdivision: 1 as const,
    }
    expect(() => allocateShots({ ...base, requestedCount: 0 })).toThrow(RangeError)
    expect(() => allocateShots({ ...base, requestedCount: 2.5 })).toThrow(RangeError)
  })

  it('セクションの尺が 0 以下なら例外', () => {
    expect(() =>
      allocateShots({
        sectionStartSec: 5,
        sectionEndSec: 5,
        beats: beatsAt120(17),
        subdivision: 1,
        requestedCount: 2,
      }),
    ).toThrow(RangeError)
  })
})

/** テスト内で `slots[i]` の undefined を畳むための型。 */
type ShotSlotLike = { readonly startSec: number; readonly durationSec: number }
