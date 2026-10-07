import { ShotId, TakeId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { TAKE_ID } from '@/__tests__/fixtures'
import {
  EMPTY_SELECTION,
  clearSelection,
  deselectShot,
  eligibilityFor,
  headerCheckboxState,
  invertSelection,
  isSelected,
  planBulkOperation,
  pruneSelection,
  selectAllVisible,
  selectShot,
  selectedShotIds,
  selectionCount,
  summarizeBulkResult,
  toggleShot,
  type BulkOutcome,
  type BulkShot,
} from '@/lib/shot-bulk'

/** ULID の文字集合（I / L / O / U を含まない）で 26 桁を作る。 */
const shotId = (suffix: string): ShotId => ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5${suffix}`)

const A = shotId('FA0')
const B = shotId('FB0')
const C = shotId('FC0')

const takeId = TakeId.parse(TAKE_ID)

const aShot = (id: ShotId, code: string, overrides: Partial<BulkShot> = {}): BulkShot => ({
  id,
  code,
  lockedAt: null,
  selectedTakeId: null,
  ...overrides,
})

const shots = [aShot(A, 'CUT-01'), aShot(B, 'CUT-02'), aShot(C, 'CUT-03')]
const visibleIds = shots.map((shot) => shot.id)

describe('選択の状態', () => {
  it('追加・除外・反転が入力の集合を書き換えない', () => {
    const before = new Set([A])

    const added = selectShot(before, B)
    const removed = deselectShot(added, A)
    const toggled = toggleShot(before, A)

    expect([...before]).toEqual([A])
    expect([...added]).toEqual([A, B])
    expect([...removed]).toEqual([B])
    expect([...toggled]).toEqual([])
  })

  it('既に入っている ID を足しても、入っていない ID を外しても壊れない', () => {
    expect([...selectShot(new Set([A]), A)]).toEqual([A])
    expect([...deselectShot(new Set([A]), B)]).toEqual([A])
  })

  it('全選択は見えている一覧の中だけ。絞り込みの外は入らない', () => {
    const visible = [A, B]

    const selection = selectAllVisible(visible)

    expect(selectionCount(selection)).toBe(2)
    expect(isSelected(selection, C)).toBe(false)
  })

  it('全解除は空になる', () => {
    expect(selectionCount(clearSelection())).toBe(0)
    expect(selectionCount(EMPTY_SELECTION)).toBe(0)
  })

  it('反転は見えている範囲で行う', () => {
    expect([...invertSelection(new Set([A]), visibleIds)]).toEqual([B, C])
  })

  it('一覧が絞られたら、見えなくなった選択を落とす', () => {
    const selection = selectAllVisible(visibleIds)

    expect([...pruneSelection(selection, [A, C])]).toEqual([A, C])
  })

  it('見出しのチェックボックスは 3 状態を返す', () => {
    expect(headerCheckboxState(EMPTY_SELECTION, visibleIds)).toBe('none')
    expect(headerCheckboxState(new Set([A]), visibleIds)).toBe('partial')
    expect(headerCheckboxState(new Set(visibleIds), visibleIds)).toBe('all')
  })

  it('一覧が 0 件なら全選択にならない', () => {
    expect(headerCheckboxState(EMPTY_SELECTION, [])).toBe('none')
  })

  /** 集合の反復順に依存させると、同じ選択でも送る本文が変わって結果を読み合わせられない。 */
  it('送る ID は一覧の並び順に揃える', () => {
    const selection = new Set([C, A])

    expect(selectedShotIds(selection, shots)).toEqual([A, C])
  })
})

describe('一括生成の適格性', () => {
  it('ロック済みは理由つきで止める', () => {
    const verdict = eligibilityFor('generate', aShot(A, 'CUT-01', { lockedAt: new Date() }))

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('ロック')
  })

  it('ロックされていなければ通す。仕様が組めるかはサーバに任せる', () => {
    expect(eligibilityFor('generate', aShot(A, 'CUT-01')).ok).toBe(true)
  })
})

/** 絵コンテの画像をまとめて作る（ADR-0029）。生成と同じく、ロック済みの Shot には触らない。 */
describe('絵コンテの画像をまとめて作るときの適格性', () => {
  it('ロック済みは理由つきで止める', () => {
    const verdict = eligibilityFor('draw', aShot(A, 'CUT-01', { lockedAt: new Date() }))

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('ロック')
  })

  it('ロックされていなければ通す（絵があるかどうかはサーバが見る）', () => {
    expect(eligibilityFor('draw', aShot(A, 'CUT-01')).ok).toBe(true)
  })
})

describe('一括採用の適格性', () => {
  /** 画面は Take の本数を知らない。ここで止めると「採用できるのに押せない」が起きる。 */
  it('Take の有無を画面で判定しない。常に通す', () => {
    expect(eligibilityFor('select-take', aShot(A, 'CUT-01')).ok).toBe(true)
  })

  it('採用済みの Shot には上書きになる注意を付ける', () => {
    const verdict = eligibilityFor('select-take', aShot(A, 'CUT-01', { selectedTakeId: takeId }))

    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.notice).toContain('上書き')
  })

  it('ロック済みでも一括採用は止めない', () => {
    expect(eligibilityFor('select-take', aShot(A, 'CUT-01', { lockedAt: new Date() })).ok).toBe(true)
  })
})

/**
 * 採用をまとめて外す（制作者 2026-10-07）。
 * **画面は判定を持たない。** 「採用していません」は API の結果で出す。
 */
describe('一括で採用を外す適格性', () => {
  it('採用していない Shot も画面では止めない（理由はサーバが返す）', () => {
    const verdict = eligibilityFor('unselect-take', aShot(A, 'CUT-01'))

    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.notice).toBeNull()
  })

  it('ロック済みでも止めない（採用を外すのは生成ではない）', () => {
    expect(eligibilityFor('unselect-take', aShot(A, 'CUT-01', { lockedAt: new Date() })).ok).toBe(
      true,
    )
  })
})

describe('一括変更の適格性', () => {
  it('制限なし。注意も付かない', () => {
    const verdict = eligibilityFor('update', aShot(A, 'CUT-01', { lockedAt: new Date() }))

    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.notice).toBeNull()
  })
})

describe('送る前の組み立て', () => {
  const locked = [shots[0]!, aShot(B, 'CUT-02', { lockedAt: new Date() }), shots[2]!]

  it('送るものと送らないものを分け、送らない理由を残す', () => {
    const plan = planBulkOperation('generate', new Set(visibleIds), locked)

    expect(plan.targetIds).toEqual([A, C])
    expect(plan.blocked).toHaveLength(1)
    expect(plan.blocked[0]?.code).toBe('CUT-02')
    expect(plan.blocked[0]?.message).toContain('ロック')
  })

  it('選択が 0 件なら送るものも 0 件', () => {
    const plan = planBulkOperation('generate', EMPTY_SELECTION, shots)

    expect(plan.targetIds).toEqual([])
    expect(plan.blocked).toEqual([])
    expect(plan.notices).toEqual([])
  })

  it('全件が対象になる', () => {
    expect(planBulkOperation('update', new Set(visibleIds), shots).targetIds).toEqual(visibleIds)
  })

  /** 黙って落とすと「27 件選んだのに 25 件しか送られない」が理由なしで起きる（L-015）。 */
  it('一覧に無い ShotId を黙って落とさず、理由つきで残す', () => {
    const plan = planBulkOperation('update', new Set([A, shotId('FZ0')]), shots)

    expect(plan.targetIds).toEqual([A])
    expect(plan.blocked).toHaveLength(1)
    expect(plan.blocked[0]?.message).toContain('一覧に見当たりません')
  })

  it('上書きになる件は止めずに注意として返す', () => {
    const withSelected = [aShot(A, 'CUT-01', { selectedTakeId: takeId }), shots[1]!]

    const plan = planBulkOperation('select-take', new Set([A, B]), withSelected)

    expect(plan.targetIds).toEqual([A, B])
    expect(plan.notices).toHaveLength(1)
    expect(plan.notices[0]?.code).toBe('CUT-01')
  })
})

describe('結果の要約', () => {
  const ok = (id: ShotId): BulkOutcome => ({ shotId: id, ok: true })
  const ng = (id: ShotId, reason: string): BulkOutcome => ({ shotId: id, ok: false, reason })

  it('全件成功なら失敗の行を出さない', () => {
    const summary = summarizeBulkResult('generate', [ok(A), ok(B)], shots, 3.2)

    expect(summary.succeededCount).toBe(2)
    expect(summary.failedCount).toBe(0)
    expect(summary.text).toBe('2 件すべてを生成に回しました。見積の合計は $3.20 です。')
  })

  it('混在なら件数と失敗の理由を両方出す', () => {
    const summary = summarizeBulkResult(
      'generate',
      [ok(A), ng(B, '仕様を組めません: Look が見つかりません'), ng(C, '他の Project の Shot です')],
      shots,
      3.2,
    )

    expect(summary.headline).toBe('3 件中 1 件を生成に回しました。見積の合計は $3.20 です。')
    expect(summary.text).toBe(
      [
        '3 件中 1 件を生成に回しました。見積の合計は $3.20 です。',
        '失敗 2 件:',
        '  CUT-02 — 仕様を組めません: Look が見つかりません',
        '  CUT-03 — 他の Project の Shot です',
      ].join('\n'),
    )
  })

  /** 理由を落とすと「2 件失敗」としか言えなくなる（L-015）。 */
  it('失敗した件の理由を 1 つも落とさない', () => {
    const summary = summarizeBulkResult(
      'select-take',
      [ng(A, 'Take がありません'), ng(B, 'Take が複数あります')],
      shots,
    )

    expect(summary.failures.map((failure) => failure.message)).toEqual([
      'Take がありません',
      'Take が複数あります',
    ])
    expect(summary.text).toContain('Take がありません')
    expect(summary.text).toContain('Take が複数あります')
  })

  it('0 件成功のときは 1 件も進んでいないと書く', () => {
    const summary = summarizeBulkResult('select-take', [ng(A, 'Take がありません')], shots)

    expect(summary.headline).toBe('1 件すべてが失敗しました。1 件も採用していません。')
  })

  /** 「採用しました」と「採用を外しました」を同じ文にしない。何をしたか読めなくなる。 */
  it('採用を外した件数を、採用したときと別の言葉で書く', () => {
    const done = summarizeBulkResult('unselect-take', [ok(A), ok(B)], shots)
    const notDone = summarizeBulkResult('unselect-take', [ng(A, '採用していません')], shots)

    expect(done.headline).toBe('2 件すべてを採用を外しました。')
    expect(notDone.headline).toBe('1 件すべてが失敗しました。1 件も採用を外していません。')
  })

  it('結果が空なら対象が無いと書く', () => {
    const summary = summarizeBulkResult('update', [], shots)

    expect(summary.text).toBe('対象の Shot がありません。')
    expect(summary.succeededCount).toBe(0)
  })

  it('成功した ShotId の集合を返す。一覧の状態はこれで更新する', () => {
    const summary = summarizeBulkResult('update', [ok(A), ng(B, 'だめ'), ok(C)], shots)

    expect([...summary.succeededIds]).toEqual([A, C])
  })

  it('コードが引けない ShotId は ID をそのまま出す', () => {
    const unknown = shotId('FZ0')

    const summary = summarizeBulkResult('update', [ng(unknown, '他の Project の Shot です')], shots)

    expect(summary.text).toContain(unknown)
  })

  it('見積を渡さない経路では金額を書かない', () => {
    const summary = summarizeBulkResult('update', [ok(A)], shots)

    expect(summary.text).toBe('1 件すべてを変更しました。')
  })

  it('操作ごとに言葉を変える', () => {
    expect(summarizeBulkResult('select-take', [ok(A)], shots).text).toBe('1 件すべてを採用しました。')
  })

  it('入力の配列を書き換えない', () => {
    const results = [ok(A), ng(B, 'だめ')]

    summarizeBulkResult('generate', results, shots, 1)

    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ shotId: A, ok: true })
  })
})
