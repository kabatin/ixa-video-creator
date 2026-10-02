import { describe, expect, it } from 'vitest'
import {
  SHOT_MIN_DURATION_SEC,
  shotBoundaryChanges,
  shotEditBlockedReason,
  shotSpanChanges,
} from '../shot-boundary.js'
import { makeShot, shotId } from './fixtures.js'

/**
 * Shot の境目・端を動かす（粗編集の変更を作る）。**純粋な関数のみ。**
 * 境目を歌い出しに揃える（2026-10-02）と、タイムラインの端のドラッグ（制作者 2026-10-02「カットの長さを、タイムラインの
 * カット部分の左右をドラッグで変えられるようにしたい」）が同じ計算を通す。当てるのは粗編集の適用（履歴に残る）。
 */

// 0–10 / 10–20 / 20–30。
const shots = [makeShot(1, 0, 10), makeShot(2, 10, 10), makeShot(3, 20, 10)]

describe('shotBoundaryChanges', () => {
  it('選んだ通りに、後ろの Shot を動かし、前後の Shot の尺を変える（全体の尺は変わらない）', () => {
    const outcome = shotBoundaryChanges(
      shots,
      new Map([
        [shotId(2), 12.5],
        [shotId(3), 19],
      ]),
    )

    expect(outcome.problem).toBeNull()
    expect(outcome.changes).toEqual([
      expect.objectContaining({ kind: 'trim', shotId: shotId(1), fromDurationSec: 10, toDurationSec: 12.5 }),
      expect.objectContaining({ kind: 'move', shotId: shotId(2), fromSec: 10, toSec: 12.5 }),
      expect.objectContaining({ kind: 'trim', shotId: shotId(2), fromDurationSec: 10, toDurationSec: 6.5 }),
      expect.objectContaining({ kind: 'move', shotId: shotId(3), fromSec: 20, toSec: 19 }),
      expect.objectContaining({ kind: 'trim', shotId: shotId(3), fromDurationSec: 10, toDurationSec: 11 }),
    ])
    const total = outcome.changes.reduce(
      (sum, change) => (change.kind === 'trim' ? sum + change.toDurationSec - change.fromDurationSec : sum),
      0,
    )
    expect(total).toBeCloseTo(0)
  })

  it('1 コマに満たない隙間は、動かすときに閉じ、動かさなければ触らない', () => {
    const tiny = [makeShot(1, 0, 10.89), makeShot(2, 10.89015873, 10)]

    expect(shotBoundaryChanges(tiny, new Map()).changes).toEqual([])
    const moved = shotBoundaryChanges(tiny, new Map([[shotId(2), 13]]))
    expect(moved.changes).toEqual([
      expect.objectContaining({ kind: 'trim', shotId: shotId(1), toDurationSec: 13 }),
      expect.objectContaining({ kind: 'move', shotId: shotId(2), toSec: 13 }),
      expect.objectContaining({ kind: 'trim', shotId: shotId(2) }),
    ])
  })

  it('動かさない（選んでいない・同じ秒）なら何も出さない', () => {
    expect(shotBoundaryChanges(shots, new Map()).changes).toEqual([])
    expect(shotBoundaryChanges(shots, new Map([[shotId(2), 10]])).changes).toEqual([])
  })

  it('選び方で Shot がつぶれる（逆転・短すぎる）なら当てず、理由を出す', () => {
    const outcome = shotBoundaryChanges(
      shots,
      new Map([
        [shotId(2), 19.8],
        [shotId(3), 19.9],
      ]),
    )

    expect(outcome.changes).toEqual([])
    expect(outcome.problem).toMatch(/S2/)
  })
})

describe('shotSpanChanges', () => {
  it('端だけを動かす（先頭の左端・最後の右端・隙間のある端）。頭が変われば move、長さが変われば trim', () => {
    const first = makeShot(1, 0, 10)

    expect(shotSpanChanges(first, { startSec: 1, durationSec: 9 }).changes).toEqual([
      expect.objectContaining({ kind: 'move', shotId: shotId(1), fromSec: 0, toSec: 1 }),
      expect.objectContaining({ kind: 'trim', shotId: shotId(1), fromDurationSec: 10, toDurationSec: 9 }),
    ])
    expect(shotSpanChanges(first, { startSec: 0, durationSec: 12 }).changes).toEqual([
      expect.objectContaining({ kind: 'trim', toDurationSec: 12 }),
    ])
    expect(shotSpanChanges(first, { startSec: 0, durationSec: 10 }).changes).toEqual([])
  })

  it(`${String(SHOT_MIN_DURATION_SEC)} 秒より短くするなら当てず、理由を出す`, () => {
    const outcome = shotSpanChanges(makeShot(1, 0, 10), { startSec: 0, durationSec: 0.3 })

    expect(outcome.changes).toEqual([])
    expect(outcome.problem).toMatch(/S1/)
  })
})

describe('shotEditBlockedReason', () => {
  it('ロック中・生成中なら理由を返し、そうでなければ null', () => {
    expect(shotEditBlockedReason(makeShot(1, 0, 10, { lockedAt: new Date('2026-10-01T00:00:00Z') }))).toMatch(/ロック/)
    expect(shotEditBlockedReason(makeShot(1, 0, 10, { status: 'generating' }))).toMatch(/生成中/)
    expect(shotEditBlockedReason(makeShot(1, 0, 10))).toBeNull()
  })
})
