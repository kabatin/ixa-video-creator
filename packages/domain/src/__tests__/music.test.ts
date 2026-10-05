import { describe, expect, it } from 'vitest'
import { MusicTrackId } from '../common/ids.js'
import {
  MUSIC_FADE_MAX_SEC,
  UpdateMusicTrackPatch,
  expandBeatGrid,
  nextMasterAfterRemoval,
  snapToBeat,
} from '../music/music.js'
import { canonicalJson } from '../generation/spec.js'
import { framesToSeconds, rangesOverlap, secondsToFrames } from '../common/time.js'

const beats = [0, 0.5, 1, 1.5, 2]

describe('snapToBeat', () => {
  it('最も近い拍へ寄せる', () => {
    expect(snapToBeat(0.6, beats)).toBe(0.5)
    expect(snapToBeat(0.76, beats)).toBe(1)
  })
  it('8分に分割したグリッドへ寄せられる', () => {
    expect(snapToBeat(0.26, beats, 0.5)).toBeCloseTo(0.25)
  })
  it('拍が無ければ入力をそのまま返す', () => {
    expect(snapToBeat(1.23, [])).toBe(1.23)
  })
})

describe('expandBeatGrid', () => {
  it('16分では拍間を 4 分割する', () => {
    const grid = expandBeatGrid([0, 1], 0.25)
    expect(grid).toEqual([0, 0.25, 0.5, 0.75, 1])
  })
})

describe('canonicalJson', () => {
  it('キー順が違っても同じ文字列になる', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } }))
      .toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }))
  })
  it('配列の順序は保持する', () => {
    expect(canonicalJson([2, 1])).toBe('[2,1]')
  })
})

describe('time', () => {
  it('秒とフレームを round で往復する', () => {
    expect(secondsToFrames(1.017, 30)).toBe(31)
    expect(framesToSeconds(30, 30)).toBe(1)
  })
  it('境界が一致する範囲は重ならない', () => {
    expect(rangesOverlap({ start: 0, end: 5 }, { start: 5, end: 10 })).toBe(false)
    expect(rangesOverlap({ start: 0, end: 5 }, { start: 4, end: 10 })).toBe(true)
  })
})

describe('nextMasterAfterRemoval（PHASE 8）', () => {
  const a = { id: MusicTrackId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1'), isMaster: false }
  const b = { id: MusicTrackId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA2'), isMaster: true }
  const c = { id: MusicTrackId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA3'), isMaster: false }

  it('マスターでない曲を外してもマスターは変えない', () => {
    expect(nextMasterAfterRemoval([a, b, c], a.id)).toBeNull()
  })

  it('マスターを外したら、残りで最初に登録した曲をマスターにする', () => {
    expect(nextMasterAfterRemoval([c, b, a], b.id)).toBe(a.id)
  })

  it('最後の 1 曲を外したら誰もマスターにならない', () => {
    expect(nextMasterAfterRemoval([b], b.id)).toBeNull()
  })

  it('知らない曲なら何もしない', () => {
    expect(nextMasterAfterRemoval([a, b], c.id)).toBeNull()
  })
})

describe('UpdateMusicTrackPatch（PHASE 8）', () => {
  it('題名・オフセット・音量だけを受ける', () => {
    expect(UpdateMusicTrackPatch.parse({ title: '新しい題名', volume: 0.5 })).toEqual({
      title: '新しい題名',
      volume: 0.5,
    })
  })

  it('マスターはこの口では変えない（知らない項目は拒否）', () => {
    expect(UpdateMusicTrackPatch.safeParse({ isMaster: true }).success).toBe(false)
  })

  it('空の題名・範囲外の音量を拒否する', () => {
    expect(UpdateMusicTrackPatch.safeParse({ title: '  ' }).success).toBe(false)
    expect(UpdateMusicTrackPatch.safeParse({ volume: 3 }).success).toBe(false)
  })

  /** BGM のフェードイン・アウト（ADR-0039）。 */
  it(`フェードは 0〜${MUSIC_FADE_MAX_SEC} 秒`, () => {
    expect(UpdateMusicTrackPatch.parse({ fadeInSec: 2, fadeOutSec: 0 })).toEqual({ fadeInSec: 2, fadeOutSec: 0 })
    expect(UpdateMusicTrackPatch.safeParse({ fadeInSec: MUSIC_FADE_MAX_SEC + 1 }).success).toBe(false)
    expect(UpdateMusicTrackPatch.safeParse({ fadeOutSec: -1 }).success).toBe(false)
  })
})
