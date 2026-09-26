import { describe, expect, it } from 'vitest'
import type { Shot } from '../shot/shot.js'
import {
  MIN_SHOT_EDIT_DURATION_SEC,
  planMerge,
  planSplit,
  shotEditBlocker,
  splitShotCode,
} from '../shot/split-merge.js'

/**
 * Shot の分割と結合（制作者の要望 2026-09-26 / ADR-0024）。
 *
 * **Take の無い Shot だけ。** Take が付いた Shot を割ると、Take がどちらのものかが決まらず、
 * 結合すると 2 つの Take の群れをどうまとめるかが決まらない。区切りから作った直後の
 * 下書きを直す用途に絞る。
 */

const shot = (overrides: Record<string, unknown> = {}): Shot =>
  ({
    id: 'shot-a',
    projectId: 'project',
    sequenceId: null,
    order: 1000,
    code: 'CUT-02',
    startSec: 10,
    durationSec: 8,
    sourceInSec: 0,
    description: '',
    dialogue: null,
    mood: null,
    locationId: null,
    selectedTakeId: null,
    status: 'draft',
    lockedAt: null,
    ...overrides,
  }) as unknown as Shot

describe('shotEditBlocker', () => {
  it('下書き・生成可能・要判断（Take 無し）は触れる', () => {
    for (const status of ['draft', 'ready', 'blocked'] as const) {
      expect(shotEditBlocker(shot({ status }))).toBeNull()
    }
  })

  it('Take がある状態（採用待ち・採用済み）は触れない', () => {
    expect(shotEditBlocker(shot({ status: 'review' }))).toContain('Take')
    expect(shotEditBlocker(shot({ status: 'approved' }))).toContain('Take')
  })

  it('生成中は触れない', () => {
    expect(shotEditBlocker(shot({ status: 'generating' }))).toContain('生成中')
  })

  it('ロックしていれば触れない（人が「触らない」と決めた）', () => {
    expect(shotEditBlocker(shot({ lockedAt: new Date() }))).toContain('ロック')
  })
})

describe('planSplit', () => {
  it('位置で前後に分ける。前は元の Shot を縮め、後ろは位置から終わりまで', () => {
    const plan = planSplit(shot(), 13)

    expect(plan).toEqual({ ok: true, firstDurationSec: 3, secondStartSec: 13, secondDurationSec: 5 })
  })

  it('端から最短の尺未満では割らない', () => {
    const edge = 10 + MIN_SHOT_EDIT_DURATION_SEC - 0.01
    const plan = planSplit(shot(), edge)

    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toContain('短すぎ')
  })

  it('Shot の外の位置では割らない（再生位置が別の Shot にある）', () => {
    const plan = planSplit(shot(), 25)

    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toContain('範囲')
  })

  it('Take がある Shot は割らない', () => {
    expect(planSplit(shot({ status: 'review' }), 13).ok).toBe(false)
  })
})

describe('planMerge', () => {
  const a = shot({ id: 'a', code: 'CUT-01', startSec: 0, durationSec: 4, order: 1000 })
  const b = shot({ id: 'b', code: 'CUT-02', startSec: 4, durationSec: 6, order: 2000 })
  const c = shot({ id: 'c', code: 'CUT-03', startSec: 10, durationSec: 5, order: 3000 })

  it('隣り合う Shot を先頭にまとめ、残りを消す', () => {
    const plan = planMerge([c, a, b])

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.keep.id).toBe('a')
    expect(plan.remove.map((s) => s.id)).toEqual(['b', 'c'])
    expect(plan.durationSec).toBe(15)
  })

  it('1 件だけでは結合しない', () => {
    expect(planMerge([a]).ok).toBe(false)
  })

  it('間に別の Shot か隙間があれば結合しない（飛び飛びをつなぐと中身が消える）', () => {
    const plan = planMerge([a, c])

    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toContain('隣り合って')
  })

  it('Sequence が違えば結合しない', () => {
    const plan = planMerge([a, shot({ ...b, sequenceId: 'seq-2' } )])

    expect(plan.ok).toBe(false)
  })

  it('Take がある Shot を含めば結合しない。どれが理由かを言う', () => {
    const plan = planMerge([a, shot({ ...b, status: 'approved' } )])

    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toContain('CUT-02')
  })
})

describe('splitShotCode', () => {
  it('元のコードに B を付け、使用済みなら次の文字', () => {
    expect(splitShotCode('CUT-02', new Set(['CUT-02']))).toBe('CUT-02B')
    expect(splitShotCode('CUT-02', new Set(['CUT-02', 'CUT-02B']))).toBe('CUT-02C')
  })

  it('割った後ろをまた割っても重ならない', () => {
    expect(splitShotCode('CUT-02B', new Set(['CUT-02', 'CUT-02B']))).toBe('CUT-02BB')
  })
})
