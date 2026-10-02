import { describe, expect, it } from 'vitest'
import {
  currentLyricIndex,
  editCue,
  lyricsSummary,
  tapCue,
  undoCue,
  type CueChange,
} from '@/lib/lyric-sync'

/**
 * 歌詞を合わせる（制作者 2026-10-01「聴きながら打つ」）。曲を流し、フレーズの歌い出しで Enter。
 * Backspace で 1 つ戻す。後から 1 つずつ時刻を直せる。時刻は行の順に後ろへ進む。
 */

const lines = ['一行目', '二行目', '三行目']

/** 断ったときの理由。打てた・直せたなら null。 */
const rejectionOf = (change: CueChange): string | null => ('rejection' in change ? change.rejection : null)

describe('tapCue', () => {
  it('次のフレーズの歌い出しを打つ', () => {
    expect(tapCue([], lines, 1.25)).toEqual({ cues: [1.25] })
    expect(tapCue([1.25], lines, 3)).toEqual({ cues: [1.25, 3] })
  })

  it('前のフレーズより前（同じ）では打てない', () => {
    expect(rejectionOf(tapCue([3], lines, 2))).toContain('後')
    expect(rejectionOf(tapCue([3], lines, 3))).not.toBeNull()
  })

  it('最後のフレーズまで打ったら、それ以上は打たない', () => {
    expect(rejectionOf(tapCue([1, 2, 3], lines, 4))).toContain('最後')
  })
})

describe('undoCue', () => {
  it('最後に打った 1 つを戻す', () => {
    expect(undoCue([1, 2])).toEqual([1])
    expect(undoCue([])).toEqual([])
  })
})

describe('editCue', () => {
  it('前後のフレーズの間なら直せる', () => {
    expect(editCue([1, 2, 3], 1, 2.5)).toEqual({ cues: [1, 2.5, 3] })
  })

  it('前後を越える時刻には直せない（順が崩れる）', () => {
    expect(rejectionOf(editCue([1, 2, 3], 1, 3.5))).not.toBeNull()
    expect(rejectionOf(editCue([1, 2, 3], 1, 0.5))).not.toBeNull()
  })
})

describe('currentLyricIndex', () => {
  it('いま歌われているフレーズ（その時刻までに歌い出した最後の行）', () => {
    expect(currentLyricIndex([1, 3], 0.5)).toBe(-1)
    expect(currentLyricIndex([1, 3], 2)).toBe(0)
    expect(currentLyricIndex([1, 3], 3)).toBe(1)
  })
})

describe('lyricsSummary', () => {
  it('フレーズの数と、どこまで時刻が付いたかを言う', () => {
    expect(lyricsSummary('', [])).toBe('歌詞はまだありません。')
    expect(lyricsSummary('一\n\n二\n三', [1])).toBe('3 フレーズ。時刻は 1 フレーズまで付いています。')
    expect(lyricsSummary('一\n二', [1, 2])).toBe('2 フレーズ。すべてに時刻が付いています。')
    expect(lyricsSummary('一\n二', [])).toBe('2 フレーズ。時刻はまだ付いていません。')
  })
})
