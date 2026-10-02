import type { ShotId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { renderRangeChoice, renderScopeLabel } from '@/lib/render-range'
import { aWorkbenchShot } from './workbench-fixture'

/**
 * 選んだ Shot だけを書き出す範囲（制作者 2026-10-02「途中までを誰かに見せたい時のために選択した Shot だけを動画として出力」）。
 * 対象は削除と同じ（チェックがあればチェックした Shot、無ければ選んでいる 1 件）。
 * 範囲は一番前の頭から一番後ろの終わりまで。飛び飛びなら間の Shot も入る（音楽を途切れさせない）。
 */

// CUT-01 4–8 / CUT-02 8–12 / CUT-03 12–16 / CUT-04 16–20（aWorkbenchShot は番号 × 4 秒から）。
const shots = [aWorkbenchShot(1), aWorkbenchShot(2), aWorkbenchShot(3), aWorkbenchShot(4)]
const idOf = (n: number): ShotId => shots[n - 1]!.id
const checked = (...ns: number[]): ReadonlySet<ShotId> => new Set(ns.map(idOf))

describe('renderRangeChoice', () => {
  it('チェックした Shot の頭から終わりまで。最初から選んでおく', () => {
    const choice = renderRangeChoice({ shots, checked: checked(3, 2), selectedShotId: idOf(1), issues: [] })

    expect(choice?.scope).toEqual({ type: 'range', start: 8, end: 16 })
    expect(choice?.label).toBe('CUT-02〜CUT-03')
    expect(choice?.span).toBe('0:08.00 – 0:16.00（8.00s）')
    expect(choice?.extraNote).toBeNull()
    expect(choice?.preferred).toBe(true)
  })

  it('飛び飛びに選んだら、間に入る Shot を知らせる', () => {
    const choice = renderRangeChoice({ shots, checked: checked(1, 4), selectedShotId: null, issues: [] })

    expect(choice?.scope).toEqual({ type: 'range', start: 4, end: 20 })
    expect(choice?.extraNote).toBe('間の CUT-02・CUT-03 も入ります')
  })

  it('チェックが無ければ選んでいる 1 件。最初は全体のまま', () => {
    const choice = renderRangeChoice({ shots, checked: new Set(), selectedShotId: idOf(2), issues: [] })

    expect(choice?.label).toBe('CUT-02')
    expect(choice?.preferred).toBe(false)
  })

  it('何も選んでいなければ出さない', () => {
    expect(renderRangeChoice({ shots, checked: new Set(), selectedShotId: null, issues: [] })).toBeNull()
  })

  it('止める指摘は範囲に掛かる Shot と、Shot に紐づかないものだけ数える。読めていなければ null', () => {
    const issues = [
      { severity: 'error' as const, code: 'shot_overlap', message: '重なり', shotId: idOf(4) },
      { severity: 'error' as const, code: 'shot_overlap', message: '重なり', shotId: idOf(2) },
      { severity: 'error' as const, code: 'transition_too_long', message: '全体' },
      { severity: 'warning' as const, code: 'shot_gap', message: '隙間', shotId: idOf(2) },
    ]

    expect(renderRangeChoice({ shots, checked: checked(1, 2), selectedShotId: null, issues })?.blockingIssueCount).toBe(2)
    expect(renderRangeChoice({ shots, checked: checked(1, 2), selectedShotId: null, issues: null })?.blockingIssueCount).toBeNull()
  })
})

describe('renderScopeLabel', () => {
  it('一部だけなら区間を、全体なら null を返す', () => {
    expect(renderScopeLabel({ type: 'range', start: 4, end: 12 })).toBe('一部 0:04.00 – 0:12.00（8.00s）')
    expect(renderScopeLabel({ type: 'full' })).toBeNull()
  })
})
