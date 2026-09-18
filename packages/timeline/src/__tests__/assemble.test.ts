import { TakeId, type HumanVerdict, type ReviewStatus, type ShotId, type Take } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { planRoughCut, type RoughCutChange, type RoughCutTake } from '../assemble.js'
import { BEATS, makeShot, makeSource, makeTransition, shotId, snapshot } from './fixtures.js'

/**
 * 粗編集の案（P63-3）の検証。
 *
 * ここで守りたいのは 4 つ。
 * 1. 指摘の定義を持たないこと（直す対象は `validateTimeline` が出したものだけ）
 * 2. 拍の吸着を書き写さないこと（拍が無ければ「拍に合わせた」と言わない）
 * 3. **決められなかったものを黙って飛ばさないこと**（必ず理由つきで `unresolved` に出る）
 * 4. すべての変更に理由が付くこと
 */

const takeId = (n: number): TakeId =>
  TakeId.parse(`01ARZ3NDEKTSV4RRFFQ69G5T${n.toString().padStart(2, '0')}`)

const makeTake = (
  n: number,
  shot: ShotId,
  overrides: Partial<RoughCutTake> = {},
): RoughCutTake => ({
  id: takeId(n),
  shotId: shot,
  index: n,
  reviewStatus: 'pending' as ReviewStatus,
  humanVerdict: 'unreviewed' as HumanVerdict,
  createdAt: new Date(`2026-09-1${n.toString()}T00:00:00.000Z`),
  ...overrides,
})

const takesOf = (
  ...entries: readonly (readonly [ShotId, readonly RoughCutTake[]])[]
): ReadonlyMap<ShotId, readonly RoughCutTake[]> => new Map(entries)

const NO_TAKES: ReadonlyMap<ShotId, readonly RoughCutTake[]> = new Map()

const moves = (changes: readonly RoughCutChange[]) => changes.filter((c) => c.kind === 'move')
const trims = (changes: readonly RoughCutChange[]) => changes.filter((c) => c.kind === 'trim')
const selects = (changes: readonly RoughCutChange[]) => changes.filter((c) => c.kind === 'select')

/** 採用 Take が無い Shot を作るための解決関数。 */
const mediaOnlyWhenSelected = (shot: { selectedTakeId: unknown; code: string }) =>
  shot.selectedTakeId === null ? undefined : `https://media.test/${shot.code}.mp4`

describe('planRoughCut / 指摘が無いとき', () => {
  it('隙間も重なりも無ければ案も未解決も空', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4)]
    const plan = planRoughCut({ source: makeSource({ shots }), beats: BEATS, takesByShot: NO_TAKES })

    expect(plan.changes).toEqual([])
    expect(plan.unresolved).toEqual([])
  })

  it('入力を変更しない', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4.3, 4)]
    const before = snapshot(shots)
    planRoughCut({ source: makeSource({ shots }), beats: BEATS, takesByShot: NO_TAKES })

    expect(snapshot(shots)).toBe(before)
  })
})

describe('planRoughCut / 隙間と重なり', () => {
  it('隙間は、後ろの Shot を拍へ寄せ、前の Shot の尺を伸ばして閉じる', () => {
    // S1 は 0–4.0、S2 は 4.3 から。0.3s の隙間。拍は 0.5s 刻みなので 4.5 へ寄る。
    const shots = [makeShot(1, 0, 4), makeShot(2, 4.3, 4)]
    const plan = planRoughCut({ source: makeSource({ shots }), beats: BEATS, takesByShot: NO_TAKES })

    const move = moves(plan.changes)[0]
    const trim = trims(plan.changes)[0]

    expect(move).toMatchObject({ shotId: shotId(2), fromSec: 4.3, toSec: 4.5 })
    expect(trim).toMatchObject({ shotId: shotId(1), fromDurationSec: 4 })
    expect(trim?.kind === 'trim' ? trim.toDurationSec : 0).toBeCloseTo(4.5, 6)
    expect(plan.unresolved).toEqual([])
  })

  it('後ろの Shot が既に拍に乗っていれば、前の Shot を縮めるだけで重なりを閉じる', () => {
    const shots = [makeShot(1, 0, 5), makeShot(2, 4, 4)]
    const plan = planRoughCut({ source: makeSource({ shots }), beats: BEATS, takesByShot: NO_TAKES })

    expect(moves(plan.changes)).toEqual([])
    expect(trims(plan.changes)[0]).toMatchObject({
      shotId: shotId(1),
      fromDurationSec: 5,
      toDurationSec: 4,
    })
  })

  it('直した結果うしろに波及しても、同じ検査を掛け直して最後まで閉じる', () => {
    // S1 を伸ばすと S2 が 4.5 へ動き、その終端 6.5 が S3（6.3 開始）と重なる。
    const shots = [makeShot(1, 0, 4), makeShot(2, 4.3, 2), makeShot(3, 6.3, 2)]
    const plan = planRoughCut({ source: makeSource({ shots }), beats: BEATS, takesByShot: NO_TAKES })

    expect(moves(plan.changes).map((c) => c.shotId)).toEqual([shotId(2), shotId(3)])
    expect(moves(plan.changes)[1]).toMatchObject({ shotId: shotId(3), fromSec: 6.3, toSec: 6.5 })
    expect(plan.unresolved).toEqual([])

    // 閉じ切ったことを、案を当てた結果でも確かめる。
    const applied = shots.map((shot) => {
      const move = moves(plan.changes).find((c) => c.shotId === shot.id)
      const trim = trims(plan.changes).find((c) => c.shotId === shot.id)
      return {
        ...shot,
        startSec: move?.kind === 'move' ? move.toSec : shot.startSec,
        durationSec: trim?.kind === 'trim' ? trim.toDurationSec : shot.durationSec,
      }
    })
    const rest = planRoughCut({
      source: makeSource({ shots: applied }),
      beats: BEATS,
      takesByShot: NO_TAKES,
    })
    expect(rest.changes).toEqual([])
    expect(rest.unresolved).toEqual([])
  })

  it('すべての変更に理由が付く', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4.3, 2), makeShot(3, 6.3, 2)]
    const plan = planRoughCut({ source: makeSource({ shots }), beats: BEATS, takesByShot: NO_TAKES })

    expect(plan.changes.length).toBeGreaterThan(0)
    for (const change of plan.changes) expect(change.reason.length).toBeGreaterThan(0)
  })

  it('理由には、直そうとしている指摘の文面がそのまま入る', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4.3, 4)]
    const plan = planRoughCut({ source: makeSource({ shots }), beats: BEATS, takesByShot: NO_TAKES })

    expect(trims(plan.changes)[0]?.reason).toContain('隙間がある')
  })

  it('尺を伸ばす案には、生成尺が足りるか分からないことを添える', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4.3, 4)]
    const plan = planRoughCut({ source: makeSource({ shots }), beats: BEATS, takesByShot: NO_TAKES })

    expect(trims(plan.changes)[0]?.reason).toContain('生成尺')
  })
})

describe('planRoughCut / 拍が無いとき', () => {
  it('拍に合わせたと言わない。後ろの Shot の開始に合わせるだけ', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4.3, 4)]
    const plan = planRoughCut({ source: makeSource({ shots }), beats: [], takesByShot: NO_TAKES })

    expect(moves(plan.changes)).toEqual([])
    expect(trims(plan.changes)[0]).toMatchObject({
      shotId: shotId(1),
      fromDurationSec: 4,
      toDurationSec: 4.3,
    })
    expect(trims(plan.changes)[0]?.reason).toContain('拍が分かっていない')
  })
})

describe('planRoughCut / 採用 Take', () => {
  const missingTakeSource = (shots: ReturnType<typeof makeShot>[]) =>
    makeSource({ shots, resolveShotMedia: mediaOnlyWhenSelected })

  it('Take が 1 件も無い Shot は、黙って飛ばさず理由つきで未解決に残す', () => {
    const shots = [makeShot(1, 0, 4)]
    const plan = planRoughCut({
      source: missingTakeSource(shots),
      beats: BEATS,
      takesByShot: NO_TAKES,
    })

    expect(selects(plan.changes)).toEqual([])
    expect(plan.unresolved).toHaveLength(1)
    expect(plan.unresolved[0]?.shotId).toBe(shotId(1))
    expect(plan.unresolved[0]?.reason).toContain('Take が 1 件も無い')
  })

  it('人が承認した Take を、自動レビュー通過より優先して採る', () => {
    const shots = [makeShot(1, 0, 4)]
    const takes = [
      makeTake(1, shotId(1), { humanVerdict: 'approved' }),
      makeTake(2, shotId(1), { reviewStatus: 'passed' }),
    ]
    const plan = planRoughCut({
      source: missingTakeSource(shots),
      beats: BEATS,
      takesByShot: takesOf([shotId(1), takes]),
    })

    expect(selects(plan.changes)[0]).toMatchObject({ shotId: shotId(1), takeId: takeId(1) })
    expect(selects(plan.changes)[0]?.reason).toContain('承認')
  })

  it('同じ強さなら新しい方（index の大きい方）を採る', () => {
    const shots = [makeShot(1, 0, 4)]
    const takes = [
      makeTake(1, shotId(1), { reviewStatus: 'passed' }),
      makeTake(3, shotId(1), { reviewStatus: 'passed' }),
    ]
    const plan = planRoughCut({
      source: missingTakeSource(shots),
      beats: BEATS,
      takesByShot: takesOf([shotId(1), takes]),
    })

    expect(selects(plan.changes)[0]).toMatchObject({ takeId: takeId(3) })
  })

  it('レビュー前の Take しか無ければ、採るが「レビュー前」と理由に書く', () => {
    const shots = [makeShot(1, 0, 4)]
    const plan = planRoughCut({
      source: missingTakeSource(shots),
      beats: BEATS,
      takesByShot: takesOf([shotId(1), [makeTake(1, shotId(1))]]),
    })

    expect(selects(plan.changes)[0]).toMatchObject({ takeId: takeId(1) })
    expect(selects(plan.changes)[0]?.reason).toContain('レビュー')
  })

  it('人が不採用にした Take と自動レビューが落とした Take は拾い直さない', () => {
    const shots = [makeShot(1, 0, 4)]
    const takes = [
      makeTake(1, shotId(1), { humanVerdict: 'rejected' }),
      makeTake(2, shotId(1), { reviewStatus: 'failed' }),
    ]
    const plan = planRoughCut({
      source: missingTakeSource(shots),
      beats: BEATS,
      takesByShot: takesOf([shotId(1), takes]),
    })

    expect(selects(plan.changes)).toEqual([])
    expect(plan.unresolved[0]?.reason).toContain('すべて')
  })

  it('採用中の Take を提案し直さない（メディアが解決できないだけのとき）', () => {
    // 採用済みだが解決できない、という状態を作る。
    const shot = makeShot(1, 0, 4, { selectedTakeId: takeId(1) as Take['id'] })
    const plan = planRoughCut({
      source: makeSource({ shots: [shot], resolveShotMedia: () => undefined }),
      beats: BEATS,
      takesByShot: takesOf([shotId(1), [makeTake(1, shotId(1), { humanVerdict: 'approved' })]]),
    })

    expect(selects(plan.changes)).toEqual([])
    expect(plan.unresolved[0]?.reason).toContain('採用中の Take 以外に候補が無い')
  })
})

describe('planRoughCut / 決められないもの', () => {
  it('前の Shot の尺が 0 以下になる境目は、動かさず理由つきで未解決に残す', () => {
    // S2 の開始が S1 の開始より前。S1 を縮めても繋げない。
    const shots = [makeShot(1, 4, 4, { order: 1000 }), makeShot(2, 4, 4, { order: 2000 })]
    const plan = planRoughCut({ source: makeSource({ shots }), beats: BEATS, takesByShot: NO_TAKES })

    expect(plan.changes).toEqual([])
    expect(plan.unresolved).toHaveLength(1)
    expect(plan.unresolved[0]?.reason).toContain('0 以下')
  })

  it('ロックされた Shot は動かさない', () => {
    const shots = [
      makeShot(1, 0, 4, { lockedAt: new Date('2026-09-17T00:00:00.000Z') }),
      makeShot(2, 4.3, 4, { lockedAt: new Date('2026-09-17T00:00:00.000Z') }),
    ]
    const plan = planRoughCut({ source: makeSource({ shots }), beats: BEATS, takesByShot: NO_TAKES })

    expect(plan.changes).toEqual([])
    expect(plan.unresolved[0]?.reason).toContain('ロック')
  })

  it('ロックされているのが後ろの Shot だけなら、拍を諦めて前の Shot の尺で閉じる', () => {
    const shots = [
      makeShot(1, 0, 4),
      makeShot(2, 4.3, 4, { lockedAt: new Date('2026-09-17T00:00:00.000Z') }),
    ]
    const plan = planRoughCut({ source: makeSource({ shots }), beats: BEATS, takesByShot: NO_TAKES })

    expect(moves(plan.changes)).toEqual([])
    expect(trims(plan.changes)[0]).toMatchObject({ toDurationSec: 4.3 })
  })

  it('この案が新しく作る指摘を黙って飲み込まない', () => {
    // S1 を 5 → 4 に縮めると、4.5s の Transition が接する Shot より長くなる。
    const shots = [makeShot(1, 0, 5), makeShot(2, 4, 5)]
    const transitions = [makeTransition(31, shotId(1), shotId(2), 4.5)]
    const plan = planRoughCut({
      source: makeSource({ shots, transitions }),
      beats: BEATS,
      takesByShot: NO_TAKES,
    })

    expect(trims(plan.changes)).toHaveLength(1)
    expect(plan.unresolved.some((u) => u.reason.includes('新しい指摘'))).toBe(true)
  })
})
