import { ProjectId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  MAX_ROWS_PER_GROUP,
  describeIssueShot,
  groupTimelineIssues,
  issueCodeLabel,
  issueShotHref,
  rowsForGroup,
  shortShotId,
} from '@/lib/issue-grouping'
import { summarizeTimelineIssues } from '@/lib/timeline-display'
import type { TimelineIssueView } from '@/lib/timeline-issues'

const SHOT_A = '01M2M3CEK506X6FRYYW9R4T5HT'
const SHOT_B = '01M2M3CEK506X6FRYYW9R4T5HW'
const PROJECT = ProjectId.parse('01M2M3CEK506X6FRYYW9R4T5HV')

const issue = (
  code: string,
  severity: TimelineIssueView['severity'],
  shotId?: string,
): TimelineIssueView => ({
  code,
  severity,
  message: `${code} の指摘`,
  ...(shotId === undefined ? {} : { shotId }),
})

const repeat = (count: number, make: (index: number) => TimelineIssueView): TimelineIssueView[] =>
  Array.from({ length: count }, (_unused, index) => make(index))

describe('groupTimelineIssues', () => {
  it('種類ごとにまとめて件数を出す', () => {
    const groups = groupTimelineIssues([
      issue('shot_overlap', 'error', SHOT_A),
      issue('shot_gap', 'warning', SHOT_B),
      issue('shot_overlap', 'error', SHOT_B),
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]?.code).toBe('shot_overlap')
    expect(groups[0]?.count).toBe(2)
    expect(groups[1]?.code).toBe('shot_gap')
    expect(groups[1]?.count).toBe(1)
  })

  it('重い種類を先に出す。件数が多くても warning は error より後', () => {
    const groups = groupTimelineIssues([
      ...repeat(72, () => issue('shot_gap', 'warning', SHOT_A)),
      issue('shot_overlap', 'error', SHOT_B),
    ])

    expect(groups.map((group) => group.code)).toEqual(['shot_overlap', 'shot_gap'])
  })

  it('同じ重さなら件数の多い種類を先に出す', () => {
    const groups = groupTimelineIssues([
      issue('shot_missing_take', 'error', SHOT_A),
      ...repeat(5, () => issue('shot_overlap', 'error', SHOT_B)),
    ])

    expect(groups.map((group) => group.code)).toEqual(['shot_overlap', 'shot_missing_take'])
  })

  it('件数も重さも同じなら最初に現れた順を保つ', () => {
    const groups = groupTimelineIssues([
      issue('clip_out_of_range', 'warning'),
      issue('shot_gap', 'warning'),
    ])

    expect(groups.map((group) => group.code)).toEqual(['clip_out_of_range', 'shot_gap'])
  })

  it('束の severity は最も重いものになる', () => {
    const groups = groupTimelineIssues([
      issue('transition_too_long', 'warning', SHOT_A),
      issue('transition_too_long', 'error', SHOT_B),
    ])

    expect(groups[0]?.severity).toBe('error')
  })

  it('巻き込んでいる Shot を重複なく数える', () => {
    const groups = groupTimelineIssues([
      issue('shot_overlap', 'error', SHOT_A),
      issue('shot_overlap', 'error', SHOT_A),
      issue('shot_overlap', 'error', SHOT_B),
      issue('shot_overlap', 'error'),
    ])

    expect(groups[0]?.count).toBe(4)
    expect(groups[0]?.shotCount).toBe(2)
  })

  it('束の中は入力の順を保つ', () => {
    const first = issue('shot_gap', 'warning', SHOT_A)
    const second = issue('shot_gap', 'warning', SHOT_B)
    const groups = groupTimelineIssues([first, issue('shot_overlap', 'error'), second])

    expect(groups.find((group) => group.code === 'shot_gap')?.issues).toEqual([first, second])
  })

  it('入力を変更しない', () => {
    const input: readonly TimelineIssueView[] = [
      issue('shot_gap', 'warning'),
      issue('shot_overlap', 'error'),
    ]
    const snapshot = [...input]

    groupTimelineIssues(input)

    expect(input).toEqual(snapshot)
  })

  it('指摘が無ければ束も無い', () => {
    expect(groupTimelineIssues([])).toEqual([])
  })

  it('121 件が 5 つの束に畳まれる', () => {
    const groups = groupTimelineIssues([
      ...repeat(72, (index) => issue('shot_overlap', 'error', `${SHOT_A}${String(index)}`)),
      ...repeat(30, () => issue('shot_gap', 'warning', SHOT_B)),
      ...repeat(15, () => issue('shot_missing_take', 'error', SHOT_A)),
      ...repeat(3, () => issue('transition_too_long', 'warning')),
      issue('clip_out_of_range', 'warning'),
    ])

    expect(groups).toHaveLength(5)
    expect(groups.reduce((total, group) => total + group.count, 0)).toBe(121)
    expect(groups.map((group) => group.code)).toEqual([
      'shot_overlap',
      'shot_missing_take',
      'shot_gap',
      'transition_too_long',
      'clip_out_of_range',
    ])
  })
})

describe('「検査できていない」と「指摘なし」を混ぜない', () => {
  it('null は unchecked、空配列は clean。束はどちらでも作らない', () => {
    expect(summarizeTimelineIssues(null).state).toBe('unchecked')
    expect(summarizeTimelineIssues([]).state).toBe('clean')
    expect(groupTimelineIssues([])).toEqual([])
  })
})

describe('rowsForGroup', () => {
  const bigGroup = groupTimelineIssues(repeat(72, () => issue('shot_overlap', 'error', SHOT_A)))[0]

  it('上限までしか出さず、隠した件数を返す', () => {
    const group = bigGroup
    if (group === undefined) throw new Error('束が作られていない')

    const { rows, hiddenCount } = rowsForGroup(group)

    expect(rows).toHaveLength(MAX_ROWS_PER_GROUP)
    expect(hiddenCount).toBe(72 - MAX_ROWS_PER_GROUP)
  })

  it('上限より少なければ全件出して hiddenCount は 0', () => {
    const group = groupTimelineIssues(repeat(3, () => issue('shot_gap', 'warning')))[0]
    if (group === undefined) throw new Error('束が作られていない')

    expect(rowsForGroup(group)).toEqual({ rows: group.issues, hiddenCount: 0 })
  })

  it('上限を渡せば従う。負の上限でも壊れない', () => {
    const group = bigGroup
    if (group === undefined) throw new Error('束が作られていない')

    expect(rowsForGroup(group, 5).rows).toHaveLength(5)
    expect(rowsForGroup(group, 5).hiddenCount).toBe(67)
    expect(rowsForGroup(group, -1)).toEqual({ rows: [], hiddenCount: 72 })
  })
})

describe('issueShotHref', () => {
  it('shotId と projectId が揃っていれば、その Shot を選んだワークベンチへのリンクになる', () => {
    expect(issueShotHref({ shotId: SHOT_A }, PROJECT)).toBe(
      `/projects/${PROJECT}?shot=${SHOT_A}&main=compare&side=inspector`,
    )
  })

  it('shotId が無ければリンクにしない', () => {
    expect(issueShotHref({ shotId: undefined }, PROJECT)).toBeNull()
  })

  it('projectId を渡せないうちはリンクにしない', () => {
    expect(issueShotHref({ shotId: SHOT_A }, undefined)).toBeNull()
  })

  it('ULID として読めない shotId はリンクにしない', () => {
    expect(issueShotHref({ shotId: 'not-a-ulid' }, PROJECT)).toBeNull()
  })
})

/**
 * 配線が入る前（projectId なし）と後（あり）で、**利用者から見える情報が減らない**こと。
 * 減ってよいのはリンクだけ。見分けまで消えると、渡し忘れた瞬間に
 * 「どの Shot の指摘か」が静かに消え、画面を見ても気付けない（lessons L-015）。
 */
describe('describeIssueShot', () => {
  it('projectId の有無で label は変わらない。変わるのは href だけ', () => {
    const target = { shotId: SHOT_A }

    const wired = describeIssueShot(target, PROJECT)
    const unwired = describeIssueShot(target, undefined)

    expect(unwired?.label).toBe(wired?.label)
    expect(wired?.href).toBe(`/projects/${PROJECT}?shot=${SHOT_A}&main=compare&side=inspector`)
    expect(unwired?.href).toBeNull()
  })

  it('ULID として読めない shotId でも見分けは出す。リンクだけ落とす', () => {
    const described = describeIssueShot({ shotId: 'not-a-ulid' }, PROJECT)

    expect(described?.label).toBe('Shot …a-ulid')
    expect(described?.href).toBeNull()
  })

  it('shotId が無ければ添えるものが無い', () => {
    expect(describeIssueShot({ shotId: undefined }, PROJECT)).toBeNull()
    expect(describeIssueShot({ shotId: undefined }, undefined)).toBeNull()
  })

  it('束の中の全件で、配線の有無によらず見分けが残る', () => {
    const group = groupTimelineIssues([
      issue('shot_overlap', 'error', SHOT_A),
      issue('shot_overlap', 'error', SHOT_B),
      issue('shot_overlap', 'error'),
    ])[0]
    if (group === undefined) throw new Error('束が作られていない')

    const labels = (projectId: typeof PROJECT | undefined): (string | null)[] =>
      group.issues.map((entry) => describeIssueShot(entry, projectId)?.label ?? null)

    expect(labels(undefined)).toEqual(labels(PROJECT))
    expect(labels(undefined)).toEqual(['Shot …R4T5HT', 'Shot …R4T5HW', null])
  })
})

describe('issueCodeLabel', () => {
  it('知っているコードは直し方の分かる言葉にする', () => {
    expect(issueCodeLabel('shot_overlap')).toBe('Shot どうしが時間で重なっている')
    expect(issueCodeLabel('shot_gap')).toBe('Shot と Shot の間に隙間がある')
  })

  it('知らないコードは黙って消さず、そのまま出す', () => {
    expect(issueCodeLabel('brand_new_code')).toBe('brand_new_code')
  })
})

describe('shortShotId', () => {
  it('末尾だけを見分けに使う', () => {
    expect(shortShotId(SHOT_A)).toBe('…R4T5HT')
    expect(shortShotId('ABC')).toBe('ABC')
  })
})
