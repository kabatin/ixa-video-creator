import type { MusicSection, Seconds, Shot } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { compactShots, moveShot, proposeShotsFromSections, trimShot } from '../edit.js'
import { BEATS, makeShot, shotId, snapshot } from './fixtures.js'

const layout = (shots: readonly Shot[]): Array<[string, number, number]> =>
  shots.map((shot) => [shot.code, shot.startSec, shot.durationSec])

/** 重なりも隙間も無いことを確認する。 */
const expectContiguous = (shots: readonly Shot[]): void => {
  for (let i = 0; i + 1 < shots.length; i += 1) {
    const current = shots[i]
    const next = shots[i + 1]
    if (current === undefined || next === undefined) continue
    expect(next.startSec).toBeCloseTo(current.startSec + current.durationSec, 9)
  }
}

const section = (start: Seconds, end: Seconds): MusicSection => ({
  start,
  end,
  label: 'verse',
  energy: 0.5,
})

describe('moveShot', () => {
  it('移動先をビートへスナップする', () => {
    const shots = [makeShot(1, 0, 2), makeShot(2, 10, 2), makeShot(3, 20, 2)]
    const moved = moveShot(shots, shotId(3), 4.3, BEATS, 1)

    expect(layout(moved)).toEqual([
      ['S1', 0, 2],
      ['S3', 4.5, 2],
      ['S2', 10, 2],
    ])
  })

  it('8 分・16 分のグリッドへもスナップする', () => {
    const shots = [makeShot(1, 0, 1)]
    expect(moveShot(shots, shotId(1), 4.2, BEATS, 0.5)[0]?.startSec).toBe(4.25)
    expect(moveShot(shots, shotId(1), 4.2, BEATS, 0.25)[0]?.startSec).toBe(4.25)
    expect(moveShot(shots, shotId(1), 4.1, BEATS, 0.25)[0]?.startSec).toBe(4.125)
  })

  it('重ならないように後続をずらす', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4), makeShot(3, 8, 4)]
    const moved = moveShot(shots, shotId(3), 4, BEATS, 1)

    expect(layout(moved)).toEqual([
      ['S1', 0, 4],
      ['S3', 4, 4],
      ['S2', 8, 4],
    ])
    expectContiguous(moved)
  })

  it('負の位置へは動かさない', () => {
    const shots = [makeShot(1, 4, 2), makeShot(2, 10, 2)]
    expect(moveShot(shots, shotId(1), -5, BEATS, 1)[0]?.startSec).toBe(0)
  })

  it('先行 Shot と重なる位置なら、その直後へ寄せる', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 10, 2)]
    const moved = moveShot(shots, shotId(2), 2, BEATS, 1)

    expect(layout(moved)).toEqual([
      ['S1', 0, 4],
      ['S2', 4, 2],
    ])
  })

  it('知らない ID なら並べ替えた複製を返す', () => {
    const shots = [makeShot(2, 4, 2), makeShot(1, 0, 2)]
    const moved = moveShot(shots, shotId(9), 4, BEATS, 1)

    expect(layout(moved)).toEqual([
      ['S1', 0, 2],
      ['S2', 4, 2],
    ])
    expect(moved).not.toBe(shots)
  })

  it('入力を変更しない', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4), makeShot(3, 8, 4)]
    const before = snapshot(shots)

    moveShot(shots, shotId(3), 4, BEATS, 1)

    expect(snapshot(shots)).toBe(before)
  })
})

describe('trimShot', () => {
  it('尺を縮めると後続が前へ詰まり、隙間も重なりもできない', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4), makeShot(3, 8, 4)]
    const trimmed = trimShot(shots, shotId(1), 2.3, BEATS, 1)

    expect(layout(trimmed)).toEqual([
      ['S1', 0, 2.5],
      ['S2', 2.5, 4],
      ['S3', 6.5, 4],
    ])
    expectContiguous(trimmed)
  })

  it('尺を伸ばすと後続が後ろへずれる', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4), makeShot(3, 8, 4)]
    const trimmed = trimShot(shots, shotId(2), 6, BEATS, 1)

    expect(layout(trimmed)).toEqual([
      ['S1', 0, 4],
      ['S2', 4, 6],
      ['S3', 10, 4],
    ])
    expectContiguous(trimmed)
  })

  it('隙間は保ったままずらす', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 6, 4)]
    const trimmed = trimShot(shots, shotId(1), 2, BEATS, 1)

    expect(layout(trimmed)).toEqual([
      ['S1', 0, 2],
      ['S2', 4, 4],
    ])
  })

  it('尺が 0 以下にならない', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4)]

    expect(trimShot(shots, shotId(1), 0, BEATS, 1)[0]?.durationSec).toBe(0.5)
    expect(trimShot(shots, shotId(1), -3, BEATS, 1)[0]?.durationSec).toBe(0.5)
    for (const requested of [0, -3, 0.01]) {
      for (const shot of trimShot(shots, shotId(1), requested, BEATS, 1)) {
        expect(shot.durationSec).toBeGreaterThan(0)
      }
    }
  })

  it('ビートが無く尺が 0 以下になる場合は元の尺を保つ', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4)]
    const trimmed = trimShot(shots, shotId(1), 0, [], 1)

    expect(layout(trimmed)).toEqual([
      ['S1', 0, 4],
      ['S2', 4, 4],
    ])
  })

  it('知らない ID なら並べ替えた複製を返す', () => {
    const shots = [makeShot(2, 4, 2), makeShot(1, 0, 2)]
    const trimmed = trimShot(shots, shotId(9), 1, BEATS, 1)

    expect(layout(trimmed)).toEqual([
      ['S1', 0, 2],
      ['S2', 4, 2],
    ])
    expect(trimmed).not.toBe(shots)
  })

  it('入力を変更しない', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4), makeShot(3, 8, 4)]
    const before = snapshot(shots)

    trimShot(shots, shotId(1), 2.3, BEATS, 1)

    expect(snapshot(shots)).toBe(before)
  })
})

describe('compactShots', () => {
  it('隙間を消す', () => {
    const shots = [makeShot(1, 2, 3), makeShot(2, 10, 4), makeShot(3, 30, 1)]
    const compacted = compactShots(shots)

    expect(layout(compacted)).toEqual([
      ['S1', 0, 3],
      ['S2', 3, 4],
      ['S3', 7, 1],
    ])
    expectContiguous(compacted)
  })

  it('尺は変えない', () => {
    const shots = [makeShot(1, 5, 3.75), makeShot(2, 20, 1.25)]
    expect(compactShots(shots).map((shot) => shot.durationSec)).toEqual([3.75, 1.25])
  })

  it('空配列でも動く', () => {
    expect(compactShots([])).toEqual([])
  })

  it('入力を変更しない', () => {
    const shots = [makeShot(1, 2, 3), makeShot(2, 10, 4)]
    const before = snapshot(shots)

    compactShots(shots)

    expect(snapshot(shots)).toBe(before)
  })
})

describe('proposeShotsFromSections', () => {
  it('セクションを目標尺に近い長さで等分する', () => {
    const proposals = proposeShotsFromSections([section(0, 8), section(8, 16)], BEATS, 4)

    expect(proposals).toEqual([
      { startSec: 0, durationSec: 4 },
      { startSec: 4, durationSec: 4 },
      { startSec: 8, durationSec: 4 },
      { startSec: 12, durationSec: 4 },
    ])
  })

  it('内側の境界をビートへスナップする', () => {
    const proposals = proposeShotsFromSections([section(0, 7)], BEATS, 2.4)

    expect(proposals.map((shot) => shot.startSec)).toEqual([0, 2.5, 4.5])
  })

  it('セクション境界をまたぐ Shot を作らない', () => {
    const sections = [section(0, 7.3), section(7.3, 15)]
    const proposals = proposeShotsFromSections(sections, BEATS, 3.5)

    expect(proposals.length).toBeGreaterThan(sections.length)
    for (const shot of proposals) {
      const end = shot.startSec + shot.durationSec
      const container = sections.find(
        (s) => shot.startSec >= s.start - 1e-9 && end <= s.end + 1e-9,
      )
      expect(container).toBeDefined()
    }
  })

  it('セクションはビートの外でも自身の境界を保つ', () => {
    const proposals = proposeShotsFromSections([section(0, 7.3)], BEATS, 3.5)
    const last = proposals[proposals.length - 1]

    expect(proposals[0]?.startSec).toBe(0)
    expect((last?.startSec ?? 0) + (last?.durationSec ?? 0)).toBeCloseTo(7.3, 9)
  })

  it('目標尺よりセクションが短ければ 1 つにまとめる', () => {
    expect(proposeShotsFromSections([section(0, 2)], BEATS, 10)).toEqual([
      { startSec: 0, durationSec: 2 },
    ])
  })

  it('尺が 0 のセクションは捨てる', () => {
    expect(proposeShotsFromSections([section(4, 4)], BEATS, 2)).toEqual([])
  })

  it('すべての案は正の尺を持つ', () => {
    const proposals = proposeShotsFromSections(
      [section(0, 3.1), section(3.1, 9.4), section(9.4, 20)],
      BEATS,
      1.5,
    )

    expect(proposals.length).toBeGreaterThan(0)
    for (const shot of proposals) expect(shot.durationSec).toBeGreaterThan(0)
  })

  it('目標尺が正でなければ例外', () => {
    expect(() => proposeShotsFromSections([section(0, 8)], BEATS, 0)).toThrow(RangeError)
    expect(() => proposeShotsFromSections([section(0, 8)], BEATS, -1)).toThrow(RangeError)
  })

  it('入力を変更しない', () => {
    const sections = [section(8, 16), section(0, 8)]
    const beats = [...BEATS]
    const before = snapshot([sections, beats])

    proposeShotsFromSections(sections, beats, 4)

    expect(snapshot([sections, beats])).toBe(before)
    expect(sections.map((s) => s.start)).toEqual([8, 0])
  })
})
