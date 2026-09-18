import { ShotId as ShotIdSchema, TakeId as TakeIdSchema, newId } from '@ixa/domain'
import type { RoughCutChange } from '@ixa/timeline'
import { describe, expect, it } from 'vitest'
import {
  buildRoughCutApplyView,
  buildRoughCutPlanView,
  roughCutChangeKey,
  roughCutShotLabel,
} from '@/lib/rough-cut'

/**
 * 粗編集の言葉（P63-3）。見たいのは 2 点。
 * 1. **案 0 件を「問題なし」と読ませないこと**（決められなかったものの件数を必ず並べる）
 * 2. 当てられなかった分を件数に畳まず、1 件ずつ理由ごと出すこと
 */

const shotId = newId(ShotIdSchema)
const otherShotId = newId(ShotIdSchema)
const takeId = newId(TakeIdSchema)

const move = (overrides: Partial<Extract<RoughCutChange, { kind: 'move' }>> = {}): RoughCutChange =>
  ({ kind: 'move', shotId, fromSec: 4.3, toSec: 4.5, reason: '隙間を閉じる', ...overrides })

describe('buildRoughCutPlanView', () => {
  it('案も未解決も無ければ「直すところはありません」', () => {
    const view = buildRoughCutPlanView({ changes: [], unresolved: [] })

    expect(view.summary).toBe('直すところはありませんでした')
    expect(view.tone).toBe('ok')
    expect(view.hasChanges).toBe(false)
  })

  it('**案が 0 件でも、決められなかったものがあればそう書く**', () => {
    const view = buildRoughCutPlanView({
      changes: [],
      unresolved: [{ shotId, reason: 'Take が 1 件も無い' }],
    })

    expect(view.summary).toContain('決められなかったものが 1 件')
    expect(view.summary).not.toContain('直すところはありませんでした')
    expect(view.tone).toBe('warn')
  })

  it('案と未解決の件数を両方並べる', () => {
    const view = buildRoughCutPlanView({
      changes: [move()],
      unresolved: [{ shotId: otherShotId, reason: 'ロック済み' }],
    })

    expect(view.summary).toContain('案が 1 件')
    expect(view.summary).toContain('決められなかったものが 1 件')
  })

  it('位置は時計、尺は秒で出す', () => {
    const view = buildRoughCutPlanView({
      changes: [
        move(),
        { kind: 'trim', shotId: otherShotId, fromDurationSec: 4, toDurationSec: 4.5, reason: 'r' },
      ],
      unresolved: [],
    })

    expect(view.changes[0]?.detail).toBe('0:04.30 → 0:04.50')
    expect(view.changes[1]?.detail).toBe('4.00s → 4.50s')
  })

  it('**理由をそのまま運ぶ。** 画面で言い換えない', () => {
    const view = buildRoughCutPlanView({
      changes: [move({ reason: 'Shot S1 と Shot S2 の間に 0.300s の隙間がある。拍 4.500s に合わせる' })],
      unresolved: [],
    })

    expect(view.changes[0]?.reason).toBe(
      'Shot S1 と Shot S2 の間に 0.300s の隙間がある。拍 4.500s に合わせる',
    )
  })

  it('同じ Shot の位置と尺は別の案として数える', () => {
    const trim: RoughCutChange = {
      kind: 'trim',
      shotId,
      fromDurationSec: 4,
      toDurationSec: 4.5,
      reason: 'r',
    }

    expect(roughCutChangeKey(move())).not.toBe(roughCutChangeKey(trim))
  })
})

describe('buildRoughCutApplyView', () => {
  it('全部当たったら件数だけ', () => {
    const view = buildRoughCutApplyView({ applied: [move()], skipped: [] })

    expect(view.summary).toBe('1 件を適用しました')
    expect(view.tone).toBe('ok')
    expect(view.skipped).toEqual([])
  })

  it('**当てられなかった分は件数に畳まず、理由ごと出す**', () => {
    const view = buildRoughCutApplyView({
      applied: [],
      skipped: [{ change: move(), reason: '案を作ったあとに Shot が動いています' }],
    })

    expect(view.summary).toContain('1 件は当てられませんでした')
    expect(view.tone).toBe('warn')
    expect(view.skipped).toHaveLength(1)
    expect(view.skipped[0]?.reason).toBe('案を作ったあとに Shot が動いています')
    expect(view.skipped[0]?.detail).toBe('0:04.30 → 0:04.50')
  })

  it('Take の採用も種別の名前で出す', () => {
    const view = buildRoughCutApplyView({
      applied: [],
      skipped: [
        { change: { kind: 'select', shotId, takeId, reason: 'r' }, reason: 'Take が見つかりません' },
      ],
    })

    expect(view.skipped[0]?.kindLabel).toBe('Take を採用する')
  })
})

describe('roughCutShotLabel', () => {
  it('code が分かっていれば code を出す', () => {
    expect(roughCutShotLabel(shotId, new Map([[shotId, 'S001']]))).toBe('S001')
  })

  it('**分からなければ省略せず ID を出す。** 何の Shot か分からない案は採否を決められない', () => {
    expect(roughCutShotLabel(shotId)).toBe(shotId)
  })
})
