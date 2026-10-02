import { describe, expect, it } from 'vitest'
import {
  LYRIC_ALIGN_MAX_SHIFT_SEC,
  lyricBoundaryChanges,
  proposeLyricBoundaries,
} from '../lyric-align.js'
import { makeShot, shotId } from './fixtures.js'

/**
 * Shot の境目を歌い出しに揃える（制作者 2026-10-02「歌詞入れて再生してみると、かなり画像と歌詞がずれてる」）。
 * 区切ったのが歌詞に時刻を付ける前だったので、境目が歌い出しより中央値 1.95 秒・最大 4.6 秒早かった。
 * 揃える先は人が選ぶ（どの絵がどの歌詞に合うかは中身で決まる）。ここは候補と既定、選んだ通りの変更を出す。
 */

// 0–10 / 10–20 / 20–30。歌い出しは 2, 12.5, 14, 19, 23。
const shots = [makeShot(1, 0, 10), makeShot(2, 10, 10), makeShot(3, 20, 10)]
const cues = [2, 12.5, 14, 19, 23]

describe('proposeLyricBoundaries', () => {
  it('境目ごとに、すぐ後の歌い出しを既定にし、近くの歌い出しを候補に出す', () => {
    const boundaries = proposeLyricBoundaries(shots, cues)

    expect(boundaries.map((boundary) => boundary.shotId)).toEqual([shotId(2), shotId(3)])
    const [first, second] = boundaries
    expect(first?.atSec).toBe(10)
    expect(first?.suggested).toEqual({ index: 1, atSec: 12.5 })
    expect(first?.choices.map((choice) => choice.atSec)).toEqual([12.5, 14])
    expect(second?.suggested).toEqual({ index: 4, atSec: 23 })
    expect(second?.choices.map((choice) => choice.atSec)).toEqual([19, 23])
  })

  it(`すぐ後の歌い出しが ${String(LYRIC_ALIGN_MAX_SHIFT_SEC)} 秒より遠ければ、既定は動かさない`, () => {
    const [boundary] = proposeLyricBoundaries([makeShot(1, 0, 10), makeShot(2, 10, 20)], [16])

    expect(boundary?.suggested).toBeNull()
    expect(boundary?.choices).toEqual([])
  })

  it('前後の Shot をつぶす候補は出さない（短くなりすぎる）', () => {
    const [boundary] = proposeLyricBoundaries([makeShot(1, 0, 10), makeShot(2, 10, 3)], [0.2, 9, 12.8])

    expect(boundary?.choices.map((choice) => choice.atSec)).toEqual([9])
  })

  it('すでに歌い出しにある境目は、その歌い出しが既定（動かない）', () => {
    const [boundary] = proposeLyricBoundaries([makeShot(1, 0, 10), makeShot(2, 10, 10)], [10, 13])

    expect(boundary?.suggested).toEqual({ index: 0, atSec: 10 })
  })

  /**
   * 手で尺を伸ばすと端数が残る（ぼくははると: CUT-01 の終わり 10.89 と CUT-02 の頭 10.89015873…、差 0.00016 秒）。
   * 1 コマに満たない差は隣り合っているとみなす（動かすときに隙間も閉じる）。
   */
  it('1 コマに満たない隙間は隣り合っているとみなす', () => {
    const [boundary] = proposeLyricBoundaries([makeShot(1, 0, 10.89), makeShot(2, 10.89015873, 10)], [13])

    expect(boundary?.blockedReason).toBeNull()
    expect(boundary?.suggested?.atSec).toBe(13)
  })

  /** 生成中に尺を変えると、古い尺の Take が返ってくる。インスペクターも生成中は開始・尺を触らせない。 */
  it('前後どちらかが生成中なら動かさず、理由を出す', () => {
    const [boundary] = proposeLyricBoundaries(
      [makeShot(1, 0, 10, { status: 'generating' }), makeShot(2, 10, 10)],
      [12],
    )

    expect(boundary?.choices).toEqual([])
    expect(boundary?.blockedReason).toMatch(/S1 は生成中/)
  })

  it('隙間・重なり・ロックのある境目は動かさず、理由を出す', () => {
    const gap = proposeLyricBoundaries([makeShot(1, 0, 9), makeShot(2, 10, 10)], [12])
    const overlap = proposeLyricBoundaries([makeShot(1, 0, 11), makeShot(2, 10, 10)], [12])
    const locked = proposeLyricBoundaries(
      [makeShot(1, 0, 10), makeShot(2, 10, 10, { lockedAt: new Date('2026-10-01T00:00:00Z') })],
      [12],
    )

    for (const [boundary] of [gap, overlap, locked]) {
      expect(boundary?.suggested).toBeNull()
      expect(boundary?.choices).toEqual([])
      expect(boundary?.blockedReason).not.toBeNull()
    }
    expect(gap[0]?.blockedReason).toMatch(/隙間/)
    expect(overlap[0]?.blockedReason).toMatch(/重な/)
    expect(locked[0]?.blockedReason).toMatch(/ロック/)
  })
})

describe('lyricBoundaryChanges', () => {
  it('選んだ通りに、後ろの Shot を動かし、前後の Shot の尺を変える（全体の尺は変わらない）', () => {
    const outcome = lyricBoundaryChanges(
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

    expect(lyricBoundaryChanges(tiny, new Map()).changes).toEqual([])
    const moved = lyricBoundaryChanges(tiny, new Map([[shotId(2), 13]]))
    expect(moved.changes).toEqual([
      expect.objectContaining({ kind: 'trim', shotId: shotId(1), toDurationSec: 13 }),
      expect.objectContaining({ kind: 'move', shotId: shotId(2), toSec: 13 }),
      expect.objectContaining({ kind: 'trim', shotId: shotId(2) }),
    ])
  })

  it('動かさない（選んでいない・同じ秒）なら何も出さない', () => {
    expect(lyricBoundaryChanges(shots, new Map()).changes).toEqual([])
    expect(lyricBoundaryChanges(shots, new Map([[shotId(2), 10]])).changes).toEqual([])
  })

  it('選び方で Shot がつぶれる（逆転・短すぎる）なら当てず、理由を出す', () => {
    const outcome = lyricBoundaryChanges(
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
