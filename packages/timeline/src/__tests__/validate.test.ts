import { describe, expect, it } from 'vitest'
import { TIMELINE_ISSUE_CODES, validateTimeline, type TimelineIssue } from '../validate.js'
import type { Transition } from '@ixa/domain'
import { makeClip, makeShot, makeSource, makeTransition, shotId, snapshot } from './fixtures.js'

const codes = (issues: readonly TimelineIssue[]): string[] => issues.map((issue) => issue.code)

const find = (issues: readonly TimelineIssue[], code: string): TimelineIssue[] =>
  issues.filter((issue) => issue.code === code)

describe('validateTimeline / error', () => {
  it('Shot の時間が重なっていれば error', () => {
    const shots = [makeShot(1, 0, 5), makeShot(2, 4, 5)]
    const issues = validateTimeline(makeSource({ shots }))
    const overlaps = find(issues, TIMELINE_ISSUE_CODES.shotOverlap)

    expect(overlaps).toHaveLength(1)
    expect(overlaps[0]?.severity).toBe('error')
    expect(overlaps[0]?.shotId).toBe(shotId(1))
  })

  it('境界が一致するだけなら重なりではない', () => {
    const shots = [makeShot(1, 0, 5), makeShot(2, 5, 5)]
    expect(codes(validateTimeline(makeSource({ shots })))).toEqual([])
  })

  it('1 つの Shot が複数の Shot をまたぐ重なりもすべて挙げる', () => {
    const shots = [makeShot(1, 0, 10), makeShot(2, 1, 1), makeShot(3, 3, 1)]
    const overlaps = find(validateTimeline(makeSource({ shots })), TIMELINE_ISSUE_CODES.shotOverlap)

    expect(overlaps).toHaveLength(2)
    expect(overlaps.every((issue) => issue.shotId === shotId(1))).toBe(true)
  })

  it('尺が 0 以下の Shot は error', () => {
    const shots = [makeShot(1, 0, 0), makeShot(2, 0, -1)]
    const issues = find(
      validateTimeline(makeSource({ shots })),
      TIMELINE_ISSUE_CODES.shotNonPositiveDuration,
    )

    expect(issues).toHaveLength(2)
    expect(issues.every((issue) => issue.severity === 'error')).toBe(true)
  })

  it('Transition が隣接していない Shot を繋いでいれば error', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4), makeShot(3, 8, 4)]
    const transitions = [makeTransition(31, shotId(1), shotId(3), 0.5)]
    const issues = find(
      validateTimeline(makeSource({ shots, transitions })),
      TIMELINE_ISSUE_CODES.transitionNotAdjacent,
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('error')
  })

  it('Transition が知らない Shot を参照していれば error', () => {
    const shots = [makeShot(1, 0, 4)]
    const transitions = [makeTransition(31, shotId(1), shotId(9), 0.5)]
    const issues = find(
      validateTimeline(makeSource({ shots, transitions })),
      TIMELINE_ISSUE_CODES.transitionNotAdjacent,
    )

    expect(issues).toHaveLength(1)
  })

  it('隣接している Shot を繋ぐ Transition は問題にしない', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4)]
    const transitions = [makeTransition(31, shotId(1), shotId(2), 0.5)]
    expect(codes(validateTimeline(makeSource({ shots, transitions })))).toEqual([])
  })

  it('Transition の尺が接する Shot の尺を超えていれば error', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 1)]
    const transitions = [makeTransition(31, shotId(1), shotId(2), 2)]
    const issues = find(
      validateTimeline(makeSource({ shots, transitions })),
      TIMELINE_ISSUE_CODES.transitionTooLong,
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('error')
  })

  it('Transition の尺が両方の Shot 以下なら問題にしない', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 1)]
    const transitions = [makeTransition(31, shotId(1), shotId(2), 1)]
    expect(codes(validateTimeline(makeSource({ shots, transitions })))).toEqual([])
  })
})

describe('validateTimeline / warning', () => {
  it('Shot の間の隙間は warning', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 6, 4)]
    const issues = find(validateTimeline(makeSource({ shots })), TIMELINE_ISSUE_CODES.shotGap)

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(issues[0]?.shotId).toBe(shotId(1))
  })

  it('採用 Take が無い Shot は warning', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4)]
    const issues = find(
      validateTimeline(
        makeSource({
          shots,
          resolveShotMedia: (shot) => (shot.id === shotId(1) ? 'https://media.test/S1.mp4' : undefined),
        }),
      ),
      TIMELINE_ISSUE_CODES.shotMissingTake,
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(issues[0]?.shotId).toBe(shotId(2))
  })

  it('タイムラインの尺をはみ出したクリップは warning', () => {
    const shots = [makeShot(1, 0, 4)]
    const clips = [makeClip(21, 'TEXT', 0, 2), makeClip(22, 'VFX', 3, 5)]
    const issues = find(
      validateTimeline(makeSource({ shots, clips })),
      TIMELINE_ISSUE_CODES.clipOutOfRange,
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
  })

  it('浮動小数の誤差を隙間やはみ出しとして扱わない', () => {
    const shots = [makeShot(1, 0, 0.1 + 0.2), makeShot(2, 0.3, 1)]
    const clips = [makeClip(21, 'TEXT', 0, 1.3)]
    expect(codes(validateTimeline(makeSource({ shots, clips })))).toEqual([])
  })
})

describe('validateTimeline / 列挙', () => {
  it('複数の問題を 1 回の呼び出しですべて挙げる', () => {
    const shots = [
      makeShot(1, 0, 5), // S2 と重なる
      makeShot(2, 4, 0), // 尺 0
      makeShot(3, 10, 4), // S2 との間に隙間
    ]
    const transitions = [makeTransition(31, shotId(1), shotId(3), 99)]
    const clips = [makeClip(21, 'TEXT', 0, 100)]
    const issues = validateTimeline(
      makeSource({
        shots,
        transitions,
        clips,
        resolveShotMedia: (shot) =>
          shot.id === shotId(3) ? undefined : `https://media.test/${shot.code}.mp4`,
      }),
    )

    expect(new Set(codes(issues))).toEqual(
      new Set([
        TIMELINE_ISSUE_CODES.shotOverlap,
        TIMELINE_ISSUE_CODES.shotNonPositiveDuration,
        TIMELINE_ISSUE_CODES.transitionNotAdjacent,
        TIMELINE_ISSUE_CODES.shotGap,
        TIMELINE_ISSUE_CODES.shotMissingTake,
        TIMELINE_ISSUE_CODES.clipOutOfRange,
      ]),
    )
    expect(issues.filter((issue) => issue.severity === 'error').length).toBeGreaterThanOrEqual(3)
    expect(issues.filter((issue) => issue.severity === 'warning').length).toBeGreaterThanOrEqual(3)
  })

  it('問題が無ければ空配列', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4)]
    const clips = [makeClip(21, 'TEXT', 0, 8)]
    const transitions = [makeTransition(31, shotId(1), shotId(2), 0.5)]
    expect(validateTimeline(makeSource({ shots, clips, transitions }))).toEqual([])
  })

  it('入力を変更しない', () => {
    const shots = [makeShot(3, 8, 2), makeShot(1, 0, 5), makeShot(2, 4, 5)]
    const clips = [makeClip(21, 'TEXT', 0, 100)]
    const before = snapshot([shots, clips])

    validateTimeline(makeSource({ shots, clips }))

    expect(snapshot([shots, clips])).toBe(before)
    expect(shots.map((shot) => shot.code)).toEqual(['S3', 'S1', 'S2'])
  })
})

describe('絵に出ない Transition（Architect 追加）', () => {
  /**
   * wipe / whip_pan / glitch はレンダリング時に cut へ落ちる。
   * 置いた本人は選んだ効果が出ると思っているので、黙って落とさない。
   */
  const sourceWith = (type: Transition['type']) => {
    const shots = [makeShot(1, 0, 2), makeShot(2, 2, 2)]
    return makeSource({
      shots,
      transitions: [{ ...makeTransition(1, shotId(1), shotId(2), 0.5), type }],
    })
  }

  const degraded = (type: Transition['type']): TimelineIssue[] =>
    find(validateTimeline(sourceWith(type)), TIMELINE_ISSUE_CODES.transitionDegraded)

  it.each(['wipe', 'whip_pan', 'glitch'] as const)('%s は warning を出す', (type) => {
    const issues = degraded(type)

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(issues[0]?.message).toContain('カット')
  })

  it.each(['cut', 'dissolve', 'dip_to_black', 'dip_to_white'] as const)(
    '%s は warning を出さない',
    (type) => {
      expect(degraded(type)).toEqual([])
    },
  )

  it('error にはしない。出力は作れるので、止めるより伝えるほうが役に立つ', () => {
    const errors = validateTimeline(sourceWith('wipe')).filter((i) => i.severity === 'error')

    expect(errors).toEqual([])
  })
})
