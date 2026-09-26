import type { MusicSection } from '@ixa/domain'
import type { SnapCandidate } from '@ixa/timeline'
import { describe, expect, it } from 'vitest'
import {
  CUT_MARK_KEY_HELP,
  COARSE_NUDGE_SEC,
  FINE_NUDGE_SEC,
  MIN_CUT_DURATION_SEC,
  addMark,
  buildCutMarkCandidates,
  buildCuts,
  cutMarkToleranceSec,
  cutBoundaries,
  describeCuts,
  isTypingTarget,
  moveMark,
  nextMarkIndex,
  normalizeMarks,
  nudgeMarkAt,
  previousMarkIndex,
  removeMarkAt,
  resolveCutMarkCommand,
  snapMarkTime,
  sortMarks,
  type CutMark,
  type KeyEventLike,
  type KeyTargetLike,
} from '@/lib/cut-marks'
import type { BeatSource } from '@/lib/timeline-snap'

const mark = (atSec: number): CutMark => ({ atSec, snappedTo: null })

const marksAt = (...seconds: readonly number[]): readonly CutMark[] => seconds.map(mark)

const section = (start: number, end: number): MusicSection => ({
  start,
  end,
  label: 'verse',
  energy: 0.5,
})

const beatSource = (beats: readonly number[]): BeatSource => ({
  state: 'available',
  trackTitle: 'iXA CUP',
  beats,
  // セクションの端は原点・終端と重ねない。重なると優先度の高いほうに畳まれて消える。
  sections: [section(3, 6)],
  drops: [],
})

const keyEvent = (overrides: Partial<KeyEventLike> & { readonly key: string }): KeyEventLike => ({
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  target: null,
  ...overrides,
})

const typingTarget = (tagName: string): KeyTargetLike => ({ tagName, isContentEditable: false })

describe('sortMarks / normalizeMarks', () => {
  it('昇順に並べ直し、入力を変更しない', () => {
    const input = marksAt(4, 1, 2)
    const sorted = sortMarks(input)

    expect(sorted.map((entry) => entry.atSec)).toEqual([1, 2, 4])
    expect(input.map((entry) => entry.atSec)).toEqual([4, 1, 2])
  })

  it('同じ位置の区切りは 1 つに畳み、先頭を残す', () => {
    const normalized = normalizeMarks([
      { atSec: 2, snappedTo: 'beat' },
      { atSec: 2, snappedTo: 'section' },
      { atSec: 0, snappedTo: null },
    ])

    expect(normalized.map((entry) => entry.atSec)).toEqual([0, 2])
    expect(normalized[1]?.snappedTo).toBe('beat')
  })

  it('非有限・負の位置は落とす', () => {
    expect(normalizeMarks(marksAt(Number.NaN, -1, 3)).map((entry) => entry.atSec)).toEqual([3])
  })
})

describe('addMark', () => {
  it('空の集合へ置ける', () => {
    const result = addMark([], mark(1.5))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.marks.map((entry) => entry.atSec)).toEqual([1.5])
    expect(result.index).toBe(0)
  })

  it('昇順を保って差し込み、選ぶべき位置を返す', () => {
    const result = addMark(marksAt(0, 4), mark(2))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.marks.map((entry) => entry.atSec)).toEqual([0, 2, 4])
    expect(result.index).toBe(1)
  })

  it('入力の配列を変更しない', () => {
    const input = marksAt(0, 4)
    const result = addMark(input, mark(2))

    expect(result.ok).toBe(true)
    expect(input.map((entry) => entry.atSec)).toEqual([0, 4])
  })

  it('同じ位置への追加は黙って無視せず duplicate で断る', () => {
    const result = addMark(marksAt(0, 4), mark(4))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('duplicate')
    expect(result.message).toContain('既に区切りがあります')
  })

  it('最小の尺よりわずかに近いと too_close で断る', () => {
    const result = addMark(marksAt(0), mark(MIN_CUT_DURATION_SEC - 0.01))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too_close')
  })

  it('ちょうど最小の尺は受け付ける（境界を含む）', () => {
    const result = addMark(marksAt(0), mark(MIN_CUT_DURATION_SEC))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [first, second] = result.marks
    expect((second?.atSec ?? 0) - (first?.atSec ?? 0)).toBeCloseTo(MIN_CUT_DURATION_SEC, 9)
  })

  it('後ろ側の区切りに近すぎる場合も断る', () => {
    const result = addMark(marksAt(10), mark(10 - MIN_CUT_DURATION_SEC + 0.05))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too_close')
  })

  it('最小の尺は呼び出し側で変えられる', () => {
    const result = addMark(marksAt(0), mark(0.2), 0.1)

    expect(result.ok).toBe(true)
  })

  it('負の位置と非有限の位置は invalid で断る', () => {
    const negative = addMark([], mark(-0.5))
    const nan = addMark([], mark(Number.NaN))

    expect(negative.ok).toBe(false)
    expect(nan.ok).toBe(false)
    if (negative.ok || nan.ok) return
    expect(negative.reason).toBe('invalid')
    expect(nan.reason).toBe('invalid')
  })

  it('曲の先頭 0 秒に置ける', () => {
    const result = addMark(marksAt(4), mark(0))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.index).toBe(0)
  })
})

describe('removeMarkAt', () => {
  it('指定した区切りだけを消す', () => {
    const result = removeMarkAt(marksAt(0, 2, 4), 1)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.marks.map((entry) => entry.atSec)).toEqual([0, 4])
    expect(result.index).toBe(1)
  })

  it('最後の 1 個を消すと選択は -1 になる', () => {
    const result = removeMarkAt(marksAt(3), 0)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.marks).toEqual([])
    expect(result.index).toBe(-1)
  })

  it('末尾を消したときは 1 つ手前を選び直す', () => {
    const result = removeMarkAt(marksAt(0, 2, 4), 2)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.index).toBe(1)
  })

  it('範囲外・未選択は missing で断る', () => {
    expect(removeMarkAt(marksAt(0, 2), -1).ok).toBe(false)
    expect(removeMarkAt(marksAt(0, 2), 2).ok).toBe(false)
    expect(removeMarkAt([], 0).ok).toBe(false)
  })

  it('入力の配列を変更しない', () => {
    const input = marksAt(0, 2, 4)
    removeMarkAt(input, 1)

    expect(input.map((entry) => entry.atSec)).toEqual([0, 2, 4])
  })
})

describe('moveMark / nudgeMarkAt', () => {
  it('動かした先が別の区切りを追い越すと位置が入れ替わる', () => {
    const result = moveMark(marksAt(0, 2, 4), 1, mark(6))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.marks.map((entry) => entry.atSec)).toEqual([0, 4, 6])
    expect(result.index).toBe(2)
  })

  it('自分自身との距離では断らない（その場に留める移動ができる）', () => {
    const result = moveMark(marksAt(0, 2, 4), 1, { atSec: 2, snappedTo: 'beat' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.marks[1]?.snappedTo).toBe('beat')
  })

  it('他の区切りに近すぎる移動は断る', () => {
    const result = moveMark(marksAt(0, 2, 4), 1, mark(4 - MIN_CUT_DURATION_SEC + 0.01))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too_close')
  })

  it('範囲外の位置指定は missing で断る', () => {
    const result = moveMark(marksAt(0, 2), 5, mark(1))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('missing')
  })

  it('微調整すると吸着は外れる', () => {
    const marks: readonly CutMark[] = [
      { atSec: 0, snappedTo: null },
      { atSec: 2, snappedTo: 'beat' },
    ]
    const result = nudgeMarkAt(marks, 1, FINE_NUDGE_SEC)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.marks[1]?.atSec).toBeCloseTo(2 + FINE_NUDGE_SEC, 9)
    expect(result.marks[1]?.snappedTo).toBeNull()
  })

  it('微調整で最小の尺を割るなら断る', () => {
    const result = nudgeMarkAt(marksAt(0, MIN_CUT_DURATION_SEC), 1, -COARSE_NUDGE_SEC)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too_close')
  })

  it('微調整で 0 秒より前に出るなら断る', () => {
    const result = nudgeMarkAt(marksAt(0.05, 4), 0, -COARSE_NUDGE_SEC)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid')
  })

  it('選ばれていない状態の微調整は missing で断る', () => {
    const result = nudgeMarkAt(marksAt(0, 2), -1, FINE_NUDGE_SEC)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('missing')
  })
})

describe('previousMarkIndex / nextMarkIndex', () => {
  const marks = marksAt(0, 2, 4)

  it('再生位置より前で最も近い区切りを返す', () => {
    expect(previousMarkIndex(marks, 3)).toBe(1)
    expect(previousMarkIndex(marks, 4.5)).toBe(2)
  })

  it('再生位置より後で最も近い区切りを返す', () => {
    expect(nextMarkIndex(marks, 3)).toBe(2)
    expect(nextMarkIndex(marks, -1)).toBe(0)
  })

  it('ちょうど区切りの上にいるときは自分を選ばない', () => {
    expect(previousMarkIndex(marks, 2)).toBe(0)
    expect(nextMarkIndex(marks, 2)).toBe(2)
  })

  it('端では -1 を返す', () => {
    expect(previousMarkIndex(marks, 0)).toBe(-1)
    expect(nextMarkIndex(marks, 4)).toBe(-1)
    expect(previousMarkIndex([], 1)).toBe(-1)
    expect(nextMarkIndex([], 1)).toBe(-1)
  })
})

/**
 * **曲の頭と終わりは、区切りを置かなくても境界にする**（制作者の指摘 2026-09-26）。
 *
 * 以前は置いた区切りの「間」だけがカットになり、区切り 4 本で 3 カット、曲の頭から
 * 最初の区切りまでと最後の区切りから終わりまでが抜けた。毎回両端に区切りを置かせるのは
 * 手間なだけで、置き忘れると書き出しで頭と尻が黒くなる。
 */
describe('buildCuts', () => {
  const SONG = 30

  it('両端から離れた N 個の区切りで N+1 個のカットができる', () => {
    expect(buildCuts(marksAt(4, 8, 12), SONG).map((cut) => cut.startSec)).toEqual([0, 4, 8, 12])
  })

  it('曲の頭から終わりまで、隙間も重なりもなく覆う', () => {
    const cuts = buildCuts(marksAt(4, 8, 12), SONG)

    expect(cuts[0]?.startSec).toBe(0)
    const last = cuts[cuts.length - 1]
    expect((last?.startSec ?? 0) + (last?.durationSec ?? 0)).toBeCloseTo(SONG, 9)
    cuts.slice(1).forEach((cut, index) => {
      const previous = cuts[index]
      expect(previous).toBeDefined()
      if (previous === undefined) return
      expect(cut.startSec).toBeCloseTo(previous.startSec + previous.durationSec, 9)
    })
  })

  it('区切り 1 個で 2 カットになる', () => {
    expect(buildCuts(marksAt(10), SONG).map((cut) => [cut.startSec, cut.durationSec])).toEqual([
      [0, 10],
      [10, 20],
    ])
  })

  it('区切りをちょうど頭と終わりに置いても、同じ境界を二重にしない', () => {
    expect(buildCuts(marksAt(0, 10, SONG), SONG).map((cut) => cut.startSec)).toEqual([0, 10])
  })

  /**
   * 頭の近くの区切りから短いカットを作らない（最短の尺を割る）。
   * その区切りを曲の頭として扱い、最初のカットを 0 秒まで伸ばす。黒い頭を残さない。
   */
  it('頭から最短の尺未満の区切りは、曲の頭として扱う', () => {
    const cuts = buildCuts(marksAt(MIN_CUT_DURATION_SEC - 0.1, 10), SONG)

    expect(cuts.map((cut) => cut.startSec)).toEqual([0, 10])
  })

  it('終わりまで最短の尺未満の区切りは、曲の終わりとして扱う', () => {
    const cuts = buildCuts(marksAt(10, SONG - (MIN_CUT_DURATION_SEC - 0.1)), SONG)

    expect(cuts.map((cut) => [cut.startSec, cut.durationSec])).toEqual([
      [0, 10],
      [10, 20],
    ])
  })

  it('両端のカットは、区切りの代わりに曲の頭・終わりを持つ（null）', () => {
    const cuts = buildCuts([{ atSec: 10, snappedTo: 'section' }], SONG)

    expect(cuts[0]?.startMark).toBeNull()
    expect(cuts[0]?.endMark?.snappedTo).toBe('section')
    expect(cuts[1]?.startMark?.snappedTo).toBe('section')
    expect(cuts[1]?.endMark).toBeNull()
  })

  it('並んでいない入力でも昇順のカットになる', () => {
    expect(buildCuts(marksAt(8, 2, 4), SONG).map((cut) => cut.startSec)).toEqual([0, 2, 4, 8])
  })

  it('区切りが 0 個ならカットは作らない（曲まるごと 1 カットを勝手に作らない）', () => {
    expect(buildCuts([], SONG)).toEqual([])
  })
})

describe('cutBoundaries', () => {
  it('送る境界は曲の頭と終わりを含む', () => {
    expect(cutBoundaries(marksAt(4, 8), 30)).toEqual([0, 4, 8, 30])
  })

  it('区切りが 0 個なら空', () => {
    expect(cutBoundaries([], 30)).toEqual([])
  })
})

describe('describeCuts', () => {
  it('読み込めていない状態をカット 0 件と混ぜない', () => {
    expect(describeCuts(null, 30)).toEqual({ state: 'unreadable' })
  })

  it('区切り 0 個は no_marks', () => {
    expect(describeCuts([], 30)).toEqual({ state: 'no_marks' })
  })

  it('区切り 1 個でカットになる（頭と終わりが境界になるため）', () => {
    const outcome = describeCuts(marksAt(4), 30)

    expect(outcome.state).toBe('cuts')
    if (outcome.state !== 'cuts') return
    expect(outcome.cuts).toHaveLength(2)
  })
})

describe('吸着', () => {
  const candidates: readonly SnapCandidate[] = buildCutMarkCandidates(
    beatSource([0, 0.5, 1, 1.5, 2]),
    8,
  )
  const tolerance = 0.05

  it('ビート・セクション・曲の両端が候補になる', () => {
    const kinds = new Set(candidates.map((candidate) => candidate.kind))

    expect(kinds.has('beat')).toBe(true)
    expect(kinds.has('section')).toBe(true)
    expect(kinds.has('end')).toBe(true)
    expect(candidates.some((candidate) => candidate.atSec === 8)).toBe(true)
  })

  it('解析が無いときはビート候補が入らない', () => {
    const none = buildCutMarkCandidates({ state: 'no_analysis', trackTitle: 'iXA CUP' }, 8)

    expect(none.some((candidate) => candidate.kind === 'beat')).toBe(false)
  })

  it('近くのビートへ寄せ、何に吸着したかを返す', () => {
    const outcome = snapMarkTime(1.48, candidates, tolerance, true)

    expect(outcome.mark.atSec).toBeCloseTo(1.5, 9)
    expect(outcome.mark.snappedTo).toBe('beat')
    expect(outcome.notice.state).toBe('snapped')
  })

  it('許容距離のちょうど境界は吸着する', () => {
    const outcome = snapMarkTime(1.5 + tolerance, candidates, tolerance, true)

    expect(outcome.mark.snappedTo).not.toBeNull()
    expect(outcome.mark.atSec).toBeCloseTo(1.5, 9)
  })

  it('許容距離を越えると吸着しない', () => {
    const outcome = snapMarkTime(1.5 + tolerance * 2, candidates, tolerance, true)

    expect(outcome.mark.snappedTo).toBeNull()
    expect(outcome.notice.state).toBe('none')
    expect(outcome.mark.atSec).toBeCloseTo(1.5 + tolerance * 2, 9)
  })

  it('候補と同じ位置に置いても「吸着した」と報告する（値では判定しない）', () => {
    const outcome = snapMarkTime(1.5, candidates, tolerance, true)

    expect(outcome.mark.atSec).toBe(1.5)
    expect(outcome.mark.snappedTo).toBe('beat')
    expect(outcome.notice.state).toBe('snapped')
  })

  it('吸着を切ると寄せない', () => {
    const outcome = snapMarkTime(1.48, candidates, tolerance, false)

    expect(outcome.mark.atSec).toBe(1.48)
    expect(outcome.mark.snappedTo).toBeNull()
    expect(outcome.notice.state).toBe('off')
  })

  it('曲の終端へも吸着する', () => {
    const outcome = snapMarkTime(7.99, candidates, tolerance, true)

    expect(outcome.mark.snappedTo).toBe('end')
    expect(outcome.mark.atSec).toBe(8)
  })

  it('許容距離はズーム率から出す（拡大すると狭くなる）', () => {
    expect(cutMarkToleranceSec(100)).toBeLessThan(cutMarkToleranceSec(10))
    expect(cutMarkToleranceSec(80)).toBeGreaterThan(0)
  })
})

describe('キーボード操作', () => {
  it('Enter と S で再生位置に区切りを置く', () => {
    expect(resolveCutMarkCommand(keyEvent({ key: 'Enter' }))).toEqual({ type: 'place_mark' })
    expect(resolveCutMarkCommand(keyEvent({ key: 's' }))).toEqual({ type: 'place_mark' })
    expect(resolveCutMarkCommand(keyEvent({ key: 'S' }))).toEqual({ type: 'place_mark' })
  })

  it('Backspace で直前の区切りを消す', () => {
    expect(resolveCutMarkCommand(keyEvent({ key: 'Backspace' }))).toEqual({
      type: 'remove_previous_mark',
    })
  })

  it('Delete と X で選んでいる区切りを消す', () => {
    expect(resolveCutMarkCommand(keyEvent({ key: 'Delete' }))).toEqual({
      type: 'remove_selected_mark',
    })
    expect(resolveCutMarkCommand(keyEvent({ key: 'x' }))).toEqual({ type: 'remove_selected_mark' })
  })

  it('素の矢印は区切りの間を移動する', () => {
    expect(resolveCutMarkCommand(keyEvent({ key: 'ArrowLeft' }))).toEqual({
      type: 'select_previous_mark',
    })
    expect(resolveCutMarkCommand(keyEvent({ key: 'ArrowRight' }))).toEqual({
      type: 'select_next_mark',
    })
  })

  it('Shift + 矢印は細かく、Alt + 矢印は粗く動かす', () => {
    expect(resolveCutMarkCommand(keyEvent({ key: 'ArrowRight', shiftKey: true }))).toEqual({
      type: 'nudge_selected_mark',
      deltaSec: FINE_NUDGE_SEC,
    })
    expect(resolveCutMarkCommand(keyEvent({ key: 'ArrowLeft', altKey: true }))).toEqual({
      type: 'nudge_selected_mark',
      deltaSec: -COARSE_NUDGE_SEC,
    })
  })

  it('N で吸着を入り切りする', () => {
    expect(resolveCutMarkCommand(keyEvent({ key: 'n' }))).toEqual({ type: 'toggle_snap' })
  })

  it('Ctrl / Cmd 付きは受け取らない', () => {
    expect(resolveCutMarkCommand(keyEvent({ key: 's', metaKey: true }))).toBeNull()
    expect(resolveCutMarkCommand(keyEvent({ key: 's', ctrlKey: true }))).toBeNull()
  })

  it('割り当ての無いキーは null', () => {
    expect(resolveCutMarkCommand(keyEvent({ key: 'q' }))).toBeNull()
    expect(resolveCutMarkCommand(keyEvent({ key: ' ' }))).toBeNull()
  })

  it('文字を打っている間は効かない', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
      expect(
        resolveCutMarkCommand(keyEvent({ key: 's', target: typingTarget(tagName) })),
      ).toBeNull()
    }
    expect(
      resolveCutMarkCommand(
        keyEvent({ key: 's', target: { tagName: 'DIV', isContentEditable: true } }),
      ),
    ).toEqual(null)
  })

  it('入力欄でないところでは効く', () => {
    expect(resolveCutMarkCommand(keyEvent({ key: 's', target: typingTarget('BUTTON') }))).toEqual({
      type: 'place_mark',
    })
  })

  it('isTypingTarget は対象が無ければ false', () => {
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget(typingTarget('DIV'))).toBe(false)
    expect(isTypingTarget(typingTarget('textarea'))).toBe(true)
  })

  it('割り当て表と実装が同じキーを指す', () => {
    expect(CUT_MARK_KEY_HELP).not.toHaveLength(0)
    expect(CUT_MARK_KEY_HELP.map((entry) => entry.keys)).toContain('Enter / S')
  })
})

describe('叩きながら置く一連の操作', () => {
  it('置く・消す・動かすを重ねても昇順と最小の尺が保たれる', () => {
    const candidates = buildCutMarkCandidates(beatSource([0, 0.5, 1, 1.5, 2, 2.5, 3]), 3)
    const tolerance = 0.06

    const placed = [0.02, 1.02, 2.48, 0.98].reduce<readonly CutMark[]>((marks, atSec) => {
      const snapped = snapMarkTime(atSec, candidates, tolerance, true)
      const result = addMark(marks, snapped.mark)
      return result.ok ? result.marks : marks
    }, [])

    // 0.98 は既にある 1.0 へ吸着して duplicate になるので入らない。
    expect(placed.map((entry) => entry.atSec)).toEqual([0, 1, 2.5])
    // 0 秒はビートでもあるがタイムラインの原点が優先される（優先度の正は packages/timeline）。
    expect(placed.map((entry) => entry.snappedTo)).toEqual(['origin', 'beat', 'beat'])

    // 曲は 3 秒。0 は曲の頭と重なるので、頭・1・2.5・終わりの 3 カット。
    const cuts = buildCuts(placed, 3)
    expect(cuts).toHaveLength(3)
    expect(cuts.every((cut) => cut.durationSec >= MIN_CUT_DURATION_SEC)).toBe(true)

    const removed = removeMarkAt(placed, 1)
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(buildCuts(removed.marks, 3)).toHaveLength(2)
  })
})
