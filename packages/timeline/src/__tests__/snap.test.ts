import type { MusicSection, Seconds } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { TIME_EPSILON } from '../ordering.js'
import {
  DEFAULT_SNAP_THRESHOLD_PX,
  collectSnapCandidates,
  snapTime,
  snapToleranceSecForZoom,
  type SnapCandidate,
  type SnapTargetKind,
} from '../snap.js'
import { BEATS, clipId, makeClip, makeShot, shotId, snapshot } from './fixtures.js'

const section = (start: Seconds, end: Seconds): MusicSection => ({
  start,
  end,
  label: 'chorus',
  energy: 0.8,
})

/** 候補を `[時刻, 種別]` の並びにして読みやすくする。 */
const pairs = (candidates: readonly SnapCandidate[]): Array<[number, SnapTargetKind]> =>
  candidates.map((candidate) => [candidate.atSec, candidate.kind])

const at = (candidates: readonly SnapCandidate[], atSec: number): SnapTargetKind | undefined =>
  candidates.find((candidate) => Math.abs(candidate.atSec - atSec) <= TIME_EPSILON)?.kind

const candidate = (atSec: number, kind: SnapTargetKind): SnapCandidate => ({ atSec, kind })

describe('collectSnapCandidates', () => {
  it('材料が何も無くても原点を返す（終端 0 は原点に畳まれる）', () => {
    expect(pairs(collectSnapCandidates({}))).toEqual([[0, 'origin']])
  })

  it('ビート・Shot 端・クリップ端・セクション・ドロップ・両端をすべて集める', () => {
    const candidates = collectSnapCandidates({
      beats: [0.5, 1, 1.5],
      shots: [makeShot(1, 3, 1)],
      clips: [makeClip(2, 'TEXT', 5, 0.5)],
      sections: [section(7, 9)],
      drops: [11],
      timelineEndSec: 13,
    })

    expect(at(candidates, 0)).toBe('origin')
    expect(at(candidates, 0.5)).toBe('beat')
    expect(at(candidates, 3)).toBe('shot_edge')
    expect(at(candidates, 4)).toBe('shot_edge')
    expect(at(candidates, 5)).toBe('clip_edge')
    expect(at(candidates, 5.5)).toBe('clip_edge')
    expect(at(candidates, 7)).toBe('section')
    expect(at(candidates, 9)).toBe('section')
    expect(at(candidates, 11)).toBe('drop')
    expect(at(candidates, 13)).toBe('end')
  })

  it('時刻の昇順に並ぶ', () => {
    const candidates = collectSnapCandidates({
      beats: BEATS,
      shots: [makeShot(1, 3.25, 1)],
      drops: [7.1],
      timelineEndSec: 40,
    })

    const times = candidates.map((entry) => entry.atSec)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('ビートが空でも構造的な候補は残る', () => {
    const candidates = collectSnapCandidates({
      beats: [],
      shots: [makeShot(1, 2, 2)],
      timelineEndSec: 10,
    })

    expect(pairs(candidates)).toEqual([
      [0, 'origin'],
      [2, 'shot_edge'],
      [4, 'shot_edge'],
      [10, 'end'],
    ])
  })

  it('ビートが 1 つだけでも subdivision で落ちない', () => {
    const candidates = collectSnapCandidates({ beats: [2], subdivision: 0.5 })
    expect(at(candidates, 2)).toBe('beat')
  })

  it('subdivision でビートを細分化する', () => {
    const candidates = collectSnapCandidates({ beats: [0, 1, 2], subdivision: 0.25 })
    expect(at(candidates, 0.25)).toBe('beat')
    expect(at(candidates, 1.75)).toBe('beat')
  })

  it('同じ時刻の候補は優先度の高い種別だけを残す', () => {
    const candidates = collectSnapCandidates({
      beats: [0, 2, 4],
      shots: [makeShot(1, 2, 2)],
      clips: [makeClip(2, 'SFX', 4, 1)],
      sections: [section(2, 4)],
      timelineEndSec: 4,
    })

    // 2.0 にはビート・Shot 開始・セクション開始が重なる → shot_edge が残る
    expect(at(candidates, 2)).toBe('shot_edge')
    // 4.0 にはビート・Shot 終了・クリップ開始・セクション終了・終端が重なる
    expect(at(candidates, 4)).toBe('shot_edge')
    expect(candidates.filter((entry) => Math.abs(entry.atSec - 4) <= TIME_EPSILON)).toHaveLength(1)
  })

  it('TIME_EPSILON 以内のずれも同じ時刻として畳む', () => {
    const candidates = collectSnapCandidates({
      beats: [2 + TIME_EPSILON / 2],
      shots: [makeShot(1, 2, 1)],
    })

    expect(candidates.filter((entry) => entry.atSec < 2.5)).toEqual([
      { atSec: 0, kind: 'origin' },
      { atSec: 2, kind: 'shot_edge' },
    ])
  })

  it('ドラッグ中の Shot 自身の端は候補にしない', () => {
    const dragged = makeShot(1, 2, 2)
    const other = makeShot(2, 6, 2)
    const candidates = collectSnapCandidates({
      shots: [dragged, other],
      excludeShotId: shotId(1),
    })

    expect(pairs(candidates)).toEqual([
      [0, 'origin'],
      [6, 'shot_edge'],
      [8, 'shot_edge'],
    ])
  })

  it('ドラッグ中のクリップ自身の端は候補にしない', () => {
    const candidates = collectSnapCandidates({
      clips: [makeClip(1, 'TEXT', 2, 1), makeClip(2, 'SFX', 6, 1)],
      excludeClipId: clipId(1),
    })

    expect(pairs(candidates)).toEqual([
      [0, 'origin'],
      [6, 'clip_edge'],
      [7, 'clip_edge'],
    ])
  })

  it('入力を変更しない', () => {
    const shots = [makeShot(1, 2, 2)]
    const clips = [makeClip(2, 'TEXT', 5, 1)]
    const beats = [0, 0.5, 1]
    const before = snapshot([shots, clips, beats])

    collectSnapCandidates({ shots, clips, beats, subdivision: 0.5 })

    expect(snapshot([shots, clips, beats])).toBe(before)
  })

  it('同じ入力なら同じ結果を返す', () => {
    const context = { beats: BEATS, shots: [makeShot(1, 3, 2)], timelineEndSec: 32 }
    expect(collectSnapCandidates(context)).toEqual(collectSnapCandidates(context))
  })
})

describe('collectSnapCandidates の歌い出し', () => {
  it('歌い出しを候補にし、同じ時刻のセクションの境目・拍より歌い出しを残す', () => {
    const sections: MusicSection[] = [{ start: 0, end: 4, label: 'intro', energy: 0.3 }]
    const candidates = collectSnapCandidates({ beats: [4], sections, lyricCues: [4, 6.5], timelineEndSec: 10 })

    expect(candidates.find((entry) => entry.atSec === 4)?.kind).toBe('lyric')
    expect(candidates.find((entry) => entry.atSec === 6.5)?.kind).toBe('lyric')
  })

  it('渡さなければ歌い出しは候補に無い', () => {
    expect(collectSnapCandidates({ beats: [1, 2], timelineEndSec: 10 }).some((entry) => entry.kind === 'lyric')).toBe(false)
  })
})

describe('collectSnapCandidates のナレーションの切れ目（ADR-0038）', () => {
  it('話し始めを候補にし、同じ時刻の拍より残す（歌い出しが同じ時刻なら歌い出しを残す）', () => {
    const candidates = collectSnapCandidates({ beats: [3, 5], lyricCues: [5], narrationCues: [3, 5, 7.25], timelineEndSec: 10 })

    expect(candidates.find((entry) => entry.atSec === 3)?.kind).toBe('narration')
    expect(candidates.find((entry) => entry.atSec === 5)?.kind).toBe('lyric')
    expect(candidates.find((entry) => entry.atSec === 7.25)?.kind).toBe('narration')
  })
})

describe('snapTime', () => {
  const candidates = [candidate(0, 'origin'), candidate(2, 'shot_edge'), candidate(5, 'beat')]

  it('許容距離内で最も近い候補へ寄せる', () => {
    expect(snapTime(2.1, candidates, 0.25)).toEqual({
      atSec: 2,
      snappedTo: { atSec: 2, kind: 'shot_edge' },
    })
  })

  it('許容距離のちょうど境界は吸着する', () => {
    const result = snapTime(2.25, candidates, 0.25)
    expect(result.snappedTo?.kind).toBe('shot_edge')
    expect(result.atSec).toBe(2)
  })

  it('許容距離をわずかに超えたら吸着しない', () => {
    const result = snapTime(2.2501, candidates, 0.25)
    expect(result).toEqual({ atSec: 2.2501, snappedTo: null })
  })

  it('境界の判定が float の誤差ですり抜けない', () => {
    // 0.1 + 0.2 = 0.30000000000000004。厳密には許容距離 0.3 を超えるが、
    // これは加算の誤差でしかないので吸着しなければならない。
    const grid = [candidate(0.1 + 0.2, 'beat')]
    expect(0.1 + 0.2 > 0.3).toBe(true)
    expect(snapTime(0, grid, 0.3).snappedTo?.kind).toBe('beat')
  })

  it('候補が 1 つも無ければ元の時刻をそのまま返す', () => {
    expect(snapTime(3.14, [], 1)).toEqual({ atSec: 3.14, snappedTo: null })
  })

  it('吸着した結果が元の値と同じでも「吸着した」と分かる（L-015）', () => {
    const result = snapTime(2, candidates, 0.25)
    expect(result.atSec).toBe(2)
    expect(result.snappedTo).toEqual({ atSec: 2, kind: 'shot_edge' })
  })

  it('許容距離 0 では完全に一致する候補にだけ吸着する', () => {
    expect(snapTime(2, candidates, 0).snappedTo?.kind).toBe('shot_edge')
    expect(snapTime(2.01, candidates, 0).snappedTo).toBeNull()
  })

  it('許容距離が負や非有限なら吸着しない', () => {
    expect(snapTime(2, candidates, -1).snappedTo).toBeNull()
    expect(snapTime(2, candidates, Number.NaN).snappedTo).toBeNull()
    expect(snapTime(2, candidates, Number.POSITIVE_INFINITY).snappedTo).toBeNull()
  })

  it('時刻が非有限なら吸着せず入力をそのまま返す', () => {
    expect(snapTime(Number.NaN, candidates, 1).snappedTo).toBeNull()
    expect(snapTime(Number.POSITIVE_INFINITY, candidates, 1)).toEqual({
      atSec: Number.POSITIVE_INFINITY,
      snappedTo: null,
    })
  })

  it('負の時刻でも近ければ原点へ寄る', () => {
    expect(snapTime(-0.2, candidates, 0.3)).toEqual({
      atSec: 0,
      snappedTo: { atSec: 0, kind: 'origin' },
    })
  })

  it('負の時刻が遠ければクランプせずそのまま返す', () => {
    expect(snapTime(-5, candidates, 0.3)).toEqual({ atSec: -5, snappedTo: null })
  })

  it('終端を超えた時刻は終端へ寄り、遠ければそのまま返す', () => {
    const withEnd = [...candidates, candidate(62, 'end')]
    expect(snapTime(62.2, withEnd, 0.3).snappedTo?.kind).toBe('end')
    expect(snapTime(100, withEnd, 0.3)).toEqual({ atSec: 100, snappedTo: null })
  })

  it('入力の候補配列を変更しない', () => {
    const before = snapshot(candidates)
    snapTime(2.1, candidates, 0.25)
    expect(snapshot(candidates)).toBe(before)
  })
})

describe('snapTime の同距離の優先順位', () => {
  /** `timeSec` の左右に同じ距離で置いた 2 候補のうち、どちらが選ばれるか。 */
  const winnerBetween = (left: SnapTargetKind, right: SnapTargetKind): SnapTargetKind | undefined =>
    snapTime(2, [candidate(1.9, left), candidate(2.1, right)], 0.2).snappedTo?.kind

  it('隙間が黒画面になるため Shot の端がビートより優先される', () => {
    expect(winnerBetween('shot_edge', 'beat')).toBe('shot_edge')
    expect(winnerBetween('beat', 'shot_edge')).toBe('shot_edge')
  })

  it('Shot の端はクリップの端・セクション・原点より優先される', () => {
    expect(winnerBetween('clip_edge', 'shot_edge')).toBe('shot_edge')
    expect(winnerBetween('section', 'shot_edge')).toBe('shot_edge')
    expect(winnerBetween('origin', 'shot_edge')).toBe('shot_edge')
  })

  it('タイムラインの両端はクリップ端より優先される', () => {
    expect(winnerBetween('clip_edge', 'origin')).toBe('origin')
    expect(winnerBetween('clip_edge', 'end')).toBe('end')
  })

  it('クリップ端 > セクション > ドロップ > ビート の順になる', () => {
    expect(winnerBetween('section', 'clip_edge')).toBe('clip_edge')
    expect(winnerBetween('drop', 'section')).toBe('section')
    expect(winnerBetween('beat', 'drop')).toBe('drop')
  })

  /**
   * 歌い出し（制作者 2026-10-02「テロップを置いたってことは時間が割とはっきりするので、区切りもつけやすくなる」）。
   * 絵と歌詞を合わせるのが目的なので、曲の構造（セクション）・拍より強く、クリップの端より弱い。
   */
  it('クリップ端 > 歌い出し > セクション > ビート の順になる', () => {
    expect(winnerBetween('lyric', 'clip_edge')).toBe('clip_edge')
    expect(winnerBetween('section', 'lyric')).toBe('lyric')
    expect(winnerBetween('lyric', 'beat')).toBe('lyric')
  })

  it('候補の並び順を入れ替えても結果が変わらない', () => {
    const entries = [candidate(1.9, 'beat'), candidate(2.1, 'shot_edge'), candidate(2.1, 'section')]
    const reversed = [...entries].reverse()
    expect(snapTime(2, entries, 0.2)).toEqual(snapTime(2, reversed, 0.2))
  })

  it('同じ種別が同距離にあるときは先に現れたほうを採る', () => {
    const entries = [candidate(1.9, 'beat'), candidate(2.1, 'beat')]
    expect(snapTime(2, entries, 0.2).snappedTo?.atSec).toBe(1.9)
  })

  it('優先度が低くても、より近ければ勝つ', () => {
    const entries = [candidate(1.5, 'shot_edge'), candidate(2.05, 'beat')]
    expect(snapTime(2, entries, 0.6).snappedTo?.kind).toBe('beat')
  })
})

describe('snapToleranceSecForZoom', () => {
  it('ズーム率から秒へ変換する', () => {
    expect(snapToleranceSecForZoom(100, 8)).toBeCloseTo(0.08, 9)
  })

  it('拡大すると細かく、縮小すると粗く吸着する', () => {
    const zoomedIn = snapToleranceSecForZoom(400)
    const zoomedOut = snapToleranceSecForZoom(25)
    expect(zoomedIn).toBeLessThan(zoomedOut)
    expect(zoomedIn).toBeCloseTo(DEFAULT_SNAP_THRESHOLD_PX / 400, 9)
  })

  it('不正なズーム率や閾値は RangeError にする', () => {
    expect(() => snapToleranceSecForZoom(0)).toThrow(RangeError)
    expect(() => snapToleranceSecForZoom(-10)).toThrow(RangeError)
    expect(() => snapToleranceSecForZoom(Number.NaN)).toThrow(RangeError)
    expect(() => snapToleranceSecForZoom(100, 0)).toThrow(RangeError)
    expect(() => snapToleranceSecForZoom(100, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})

describe('collectSnapCandidates と snapTime の組み合わせ', () => {
  it('120 BPM のグリッド上でクリップ端をビートへ寄せる', () => {
    const candidates = collectSnapCandidates({
      beats: BEATS,
      shots: [makeShot(1, 4, 2)],
      timelineEndSec: 32,
    })
    const tolerance = snapToleranceSecForZoom(120)

    // 拍間隔 0.5 秒。3.47 は 3.5 へ寄る。
    expect(snapTime(3.47, candidates, tolerance)).toEqual({
      atSec: 3.5,
      snappedTo: { atSec: 3.5, kind: 'beat' },
    })
    // Shot の終端 6.0 はビートでもあるが、理由は shot_edge として返る。
    expect(snapTime(5.98, candidates, tolerance).snappedTo).toEqual({ atSec: 6, kind: 'shot_edge' })
  })

  it('拡大すると吸着しなくなった位置に細かく置ける', () => {
    const candidates = collectSnapCandidates({ beats: BEATS, timelineEndSec: 32 })

    expect(snapTime(3.46, candidates, snapToleranceSecForZoom(100)).snappedTo?.kind).toBe('beat')
    expect(snapTime(3.46, candidates, snapToleranceSecForZoom(1000)).snappedTo).toBeNull()
  })
})
