import {
  ShotId as ShotIdSchema,
  StoryboardDraftItemId as StoryboardDraftItemIdSchema,
  StoryboardDraftRunId as StoryboardDraftRunIdSchema,
  newId,
  type ShotId,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_DESCRIPTION_LABEL,
  EMPTY_MOOD_LABEL,
  adoptableShotIds,
  buildDraftRows,
  buildDraftSummary,
  STALLED_AFTER_MS,
  clearSelection,
  countUnmatchedItems,
  describeCurrent,
  describeRunning,
  describeMood,
  selectAllSelectable,
  toggleSelection,
  type CurrentShot,
} from '@/lib/storyboard-draft'
import type {
  WireStoryboardDraftItem,
  WireStoryboardDraftRun,
} from '@/lib/storyboard-draft-api'

/**
 * 絵コンテ下書きの表示ロジック（P63-4）。
 *
 * 固定したいのは 2 点。
 * **既定で 1 件も選ばれていないこと**と、**採用済みの行を選び直せないこと**。
 * どちらかが崩れると、押していない Shot が書き換わる。
 */

const RUN_ID = newId(StoryboardDraftRunIdSchema)
/** run の作成時刻。**経過の言葉を試すため、今の時刻は必ず引数で渡す。** */
const STARTED_AT = '2026-09-18T00:00:00.000Z'
const NOW = new Date('2026-09-18T00:03:00.000Z')

const aRun = (overrides: Partial<WireStoryboardDraftRun> = {}): WireStoryboardDraftRun => ({
  id: RUN_ID,
  projectId: '01M2M3CEK506X6FRYYW9R4T5HT',
  drafter: 'stub-storyboard-drafter',
  status: 'done',
  costUsd: 0,
  error: null,
  createdAt: STARTED_AT,
  ...overrides,
})

const anItem = (
  shotId: ShotId,
  overrides: Partial<WireStoryboardDraftItem> = {},
): WireStoryboardDraftItem => ({
  id: newId(StoryboardDraftItemIdSchema),
  runId: RUN_ID,
  shotId,
  description: '決勝卓を引きで捉える',
  mood: '静かな緊張',
  reason: 'intro の静けさを保つため',
  adoptedAt: null,
  createdAt: '2026-09-18T00:00:00.000Z',
  ...overrides,
})

const aShot = (overrides: Partial<CurrentShot> = {}): CurrentShot => ({
  id: overrides.id ?? newId(ShotIdSchema),
  code: overrides.code ?? 'INTRO-01',
  description: overrides.description ?? '元の説明',
  mood: overrides.mood === undefined ? '元の雰囲気' : overrides.mood,
})

describe('buildDraftRows', () => {
  it('Shot の並びを正として行を作る（案の順番では並べない）', () => {
    const first = aShot({ code: 'A' })
    const second = aShot({ code: 'B' })
    const rows = buildDraftRows([anItem(second.id), anItem(first.id)], [first, second])

    expect(rows.map((row) => row.code)).toEqual(['A', 'B'])
  })

  it('いまの説明と案を両方持つ（採用で何が変わるかを見せるため）', () => {
    const shot = aShot({ description: '元の説明' })
    const [row] = buildDraftRows([anItem(shot.id, { description: '案の説明' })], [shot])

    expect(row?.currentDescription).toBe('元の説明')
    expect(row?.proposedDescription).toBe('案の説明')
  })

  it('理由を必ず持つ', () => {
    const shot = aShot()
    const [row] = buildDraftRows([anItem(shot.id, { reason: '拍の頭だから' })], [shot])
    expect(row?.reason).toBe('拍の頭だから')
  })

  it('案の無い Shot は行にしない', () => {
    const withDraft = aShot({ code: 'A' })
    const withoutDraft = aShot({ code: 'B' })
    const rows = buildDraftRows([anItem(withDraft.id)], [withDraft, withoutDraft])

    expect(rows.map((row) => row.code)).toEqual(['A'])
  })

  /** **`adoptedAt` の null は「まだ決めていない」。「不採用」ではない**（L-021）。 */
  it('adoptedAt が null の行は undecided であって不採用ではない', () => {
    const shot = aShot()
    const [row] = buildDraftRows([anItem(shot.id, { adoptedAt: null })], [shot])

    expect(row?.decision).toBe('undecided')
    expect(row?.selectable).toBe(true)
  })

  it('採用済みの行は選び直せない', () => {
    const shot = aShot()
    const [row] = buildDraftRows(
      [anItem(shot.id, { adoptedAt: '2026-09-18T01:00:00.000Z' })],
      [shot],
    )

    expect(row?.decision).toBe('adopted')
    expect(row?.selectable).toBe(false)
  })

  it('いまの説明と案が同じなら unchanged を立てる', () => {
    const shot = aShot({ description: '同じ文', mood: '同じ雰囲気' })
    const [row] = buildDraftRows(
      [anItem(shot.id, { description: '同じ文', mood: '同じ雰囲気' })],
      [shot],
    )

    expect(row?.unchanged).toBe(true)
  })
})

describe('countUnmatchedItems', () => {
  it('画面が知らない Shot の案を数える（黙って落とさない）', () => {
    const known = aShot()
    const items = [anItem(known.id), anItem(newId(ShotIdSchema))]

    expect(countUnmatchedItems(items, [known])).toBe(1)
  })

  it('すべて対応が取れていれば 0', () => {
    const known = aShot()
    expect(countUnmatchedItems([anItem(known.id)], [known])).toBe(0)
  })
})

describe('選択の操作', () => {
  it('既定は空（1 件も選ばれていない）', () => {
    expect(clearSelection().size).toBe(0)
  })

  it('切り替えは新しい集合を返す（破壊的変更をしない）', () => {
    const shotId = newId(ShotIdSchema)
    const before = clearSelection()
    const after = toggleSelection(before, shotId)

    expect(before.size).toBe(0)
    expect(after.has(shotId)).toBe(true)
  })

  it('もう一度切り替えると外れる', () => {
    const shotId = newId(ShotIdSchema)
    expect(toggleSelection(toggleSelection(clearSelection(), shotId), shotId).size).toBe(0)
  })

  /** 全選択でも採用済みには触らない。**触ると採用時刻が動きうる。** */
  it('全選択はまだ決めていない行だけを選ぶ', () => {
    const undecided = aShot({ code: 'A' })
    const adopted = aShot({ code: 'B' })
    const rows = buildDraftRows(
      [
        anItem(undecided.id),
        anItem(adopted.id, { adoptedAt: '2026-09-18T01:00:00.000Z' }),
      ],
      [undecided, adopted],
    )

    const selected = selectAllSelectable(rows)
    expect(selected.has(undecided.id)).toBe(true)
    expect(selected.has(adopted.id)).toBe(false)
  })

  it('採用に送るのは、選ばれていてまだ決めていない行だけ', () => {
    const undecided = aShot({ code: 'A' })
    const adopted = aShot({ code: 'B' })
    const rows = buildDraftRows(
      [
        anItem(undecided.id),
        anItem(adopted.id, { adoptedAt: '2026-09-18T01:00:00.000Z' }),
      ],
      [undecided, adopted],
    )

    // 採用済みまで含めて選ばれていても、送るのは未決の 1 件だけ。
    const selected = new Set([undecided.id, adopted.id])
    expect(adoptableShotIds(rows, selected)).toEqual([undecided.id])
  })
})

describe('buildDraftSummary', () => {
  const shot = aShot()
  const rows = buildDraftRows([anItem(shot.id)], [shot])
  const empty = clearSelection()

  it('まだ下書きしていなければ採用できない', () => {
    const summary = buildDraftSummary({ run: null, rows: [], selected: empty, unmatchedCount: 0, now: NOW })

    expect(summary.headline).toBe('まだ下書きしていません')
    expect(summary.canAdopt).toBe(false)
  })

  it('0 件選択では採用を押させない', () => {
    const summary = buildDraftSummary({ run: aRun(), rows, selected: empty, unmatchedCount: 0, now: NOW })
    expect(summary.canAdopt).toBe(false)
  })

  it('選んだ件数をボタンの文言に出す', () => {
    const summary = buildDraftSummary({
      run: aRun(),
      rows,
      selected: new Set([shot.id]),
      unmatchedCount: 0,
      now: NOW,
    })

    expect(summary.canAdopt).toBe(true)
    expect(summary.adoptLabel).toContain('1 件')
  })

  it('案の件数と採用済みの件数を見出しに出す（色だけにしない）', () => {
    const adoptedShot = aShot({ code: 'B' })
    const both = buildDraftRows(
      [anItem(shot.id), anItem(adoptedShot.id, { adoptedAt: '2026-09-18T01:00:00.000Z' })],
      [shot, adoptedShot],
    )
    const summary = buildDraftSummary({
      run: aRun(),
      rows: both,
      selected: empty,
      unmatchedCount: 0,
      now: NOW,
    })

    expect(summary.headline).toBe('2 件の案のうち 1 件を採用済み')
  })

  /** 失敗を握り潰さない。理由が出ないと「押したのに何も起きなかった」と読める。 */
  it('失敗した run は理由を出し、採用させない', () => {
    const summary = buildDraftSummary({
      run: aRun({
        status: 'failed',
        error: { code: 'cli_timeout', message: 'CLI が終了しませんでした' },
      }),
      rows,
      selected: new Set([shot.id]),
      unmatchedCount: 0,
      now: NOW,
    })

    expect(summary.headline).toBe('下書きに失敗しました')
    expect(summary.notice).toContain('CLI が終了しませんでした')
    expect(summary.notice).toContain('cli_timeout')
    expect(summary.canAdopt).toBe(false)
  })

  it('失敗の理由が記録されていなければ、そのことを出す（空欄にしない）', () => {
    const summary = buildDraftSummary({
      run: aRun({ status: 'failed', error: null }),
      rows,
      selected: empty,
      unmatchedCount: 0,
      now: NOW,
    })

    expect(summary.notice).toBe('理由が記録されていません')
  })

  it('実行中は採用させず、いつ始まったかを添える', () => {
    const summary = buildDraftSummary({
      run: aRun({ status: 'running' }),
      rows,
      selected: new Set([shot.id]),
      unmatchedCount: 0,
      now: NOW,
    })

    expect(summary.headline).toBe('下書きを作っています')
    expect(summary.notice).toBe('3 分前に始まりました')
    expect(summary.canAdopt).toBe(false)
  })

  /** **止まったまま残った run を「実行中」と見せ続けない。** 待てば終わると誤解させる。 */
  it('実行中のまま長く残った run は、止まった可能性を出す', () => {
    const summary = buildDraftSummary({
      run: aRun({ status: 'running' }),
      rows,
      selected: empty,
      unmatchedCount: 0,
      now: new Date(new Date(STARTED_AT).getTime() + STALLED_AFTER_MS),
    })

    expect(summary.notice).toContain('止まった可能性')
  })

  it('対応の取れない案があれば件数を出す（黙って落とさない）', () => {
    const summary = buildDraftSummary({
      run: aRun(),
      rows,
      selected: empty,
      unmatchedCount: 3,
      now: NOW,
    })

    expect(summary.notice).toContain('3 件')
  })
})

describe('空の値の言い換え', () => {
  it('説明が空なら「未記入」と出す（空欄にしない）', () => {
    expect(describeCurrent('   ')).toBe(EMPTY_DESCRIPTION_LABEL)
  })

  it('雰囲気が null なら「未設定」と出す', () => {
    expect(describeMood(null)).toBe(EMPTY_MOOD_LABEL)
  })

  it('値があればそのまま出す', () => {
    expect(describeCurrent('ステージ中央')).toBe('ステージ中央')
    expect(describeMood('高揚')).toBe('高揚')
  })
})

describe('describeRunning', () => {
  it('1 分未満は「さきほど」と出す（0 分と書かない）', () => {
    expect(describeRunning(STARTED_AT, new Date(new Date(STARTED_AT).getTime() + 30_000))).toBe(
      'さきほどに始まりました',
    )
  })

  it('経過が上限に達したら止まった可能性を出す', () => {
    const now = new Date(new Date(STARTED_AT).getTime() + STALLED_AFTER_MS)
    expect(describeRunning(STARTED_AT, now)).toContain('止まった可能性があります')
  })

  it('上限の 1 ミリ秒手前なら、まだ止まったとは言わない（境界を二重に数えない）', () => {
    const now = new Date(new Date(STARTED_AT).getTime() + STALLED_AFTER_MS - 1)
    expect(describeRunning(STARTED_AT, now)).not.toContain('止まった可能性')
  })

  it('読めない時刻はそう書く（0 分に畳まない）', () => {
    expect(describeRunning('not-a-date', NOW)).toBe('開始時刻が読めません')
  })
})
