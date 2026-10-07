import { MAX_DRAFT_DESCRIPTION_LENGTH, MAX_DRAFT_REASON_LENGTH, StoryboardDraftCamera } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { StoryboardDraftedItem } from '../storyboard-port.js'
import {
  STUB_STORYBOARD_DRAFTER_NAME,
  createStubStoryboardDrafter,
  sectionAt,
  stubDraftItem,
} from '../stub-drafter.js'
import { SECTIONS, aDraftRequest, aDraftShot } from './draft-fixtures.js'

/**
 * スタブ下書き（P63-4）。
 *
 * 見たいのは案の出来ではなく、**配線が成立すること**:
 * 依頼した Shot に過不足なく 1 件ずつ返り、理由が必ず埋まり、
 * 同じ依頼なら同じ案になること。
 */

const drafter = createStubStoryboardDrafter()

describe('スタブ下書きの正常系', () => {
  it('依頼した Shot すべてに 1 件ずつ案を返す', async () => {
    const shots = [
      aDraftShot({ code: 'INTRO-01', startSec: 0 }),
      aDraftShot({ code: 'CHORUS-01', startSec: 8 }),
      aDraftShot({ code: 'CHORUS-02', startSec: 10 }),
    ]
    const outcome = await drafter.draft(aDraftRequest({ shots }))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.items.map((item) => item.shotId)).toEqual(shots.map((shot) => shot.id))
  })

  it('costUsd は 0（実際に払っていないので推測値を入れない）', async () => {
    const outcome = await drafter.draft(aDraftRequest())
    expect(outcome.ok && outcome.costUsd).toBe(0)
  })

  it('理由を必ず埋める（空の理由では採否を判断できない）', async () => {
    const shots = [aDraftShot({ code: 'A' }), aDraftShot({ code: 'B', startSec: 8 })]
    const outcome = await drafter.draft(aDraftRequest({ shots }))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    for (const item of outcome.items) {
      expect(item.reason.trim().length).toBeGreaterThan(0)
    }
  })

  it('同じ依頼なら同じ案になる（乱数も時刻も使わない）', async () => {
    const request = aDraftRequest({ shots: [aDraftShot({ code: 'X' })] })
    const first = await drafter.draft(request)
    const second = await drafter.draft(request)

    expect(first).toEqual(second)
  })

  it('いまの説明が違えば案も変わる（入力に依存している）', () => {
    const base = aDraftShot({ code: 'SAME' })
    const a = stubDraftItem({ ...base, description: '' }, SECTIONS)
    const b = stubDraftItem({ ...base, description: '主役の背中' }, SECTIONS)

    expect(a).not.toEqual(b)
  })

  it('案はドメインの契約を満たす（長さ・必須項目）', () => {
    const item = stubDraftItem(aDraftShot({ code: 'LONG'.repeat(4) }), SECTIONS)

    expect(StoryboardDraftedItem.safeParse(item).success).toBe(true)
    expect(item.description.length).toBeLessThanOrEqual(MAX_DRAFT_DESCRIPTION_LENGTH)
    expect(item.reason.length).toBeLessThanOrEqual(MAX_DRAFT_REASON_LENGTH)
  })

  it('既定の名前を持つ（どの口で作った案かを run に残すため）', () => {
    expect(drafter.name).toBe(STUB_STORYBOARD_DRAFTER_NAME)
  })
})

describe('スタブ下書きと音楽セクション', () => {
  it('セクションに乗っている Shot は理由にラベルを書く', () => {
    const item = stubDraftItem(aDraftShot({ startSec: 10 }), SECTIONS)
    expect(item.reason).toContain('chorus')
  })

  it('解析が無ければ「未解析」と書く（セクション不明を黙って埋めない）', () => {
    const item = stubDraftItem(aDraftShot({ startSec: 10 }), [])
    expect(item.reason).toContain('未解析')
  })

  it('セクションの終端は次のセクションに入る（境界を二重に数えない）', () => {
    expect(sectionAt(SECTIONS, 8)?.label).toBe('chorus')
    expect(sectionAt(SECTIONS, 7.9)?.label).toBe('intro')
  })

  it('どのセクションにも乗らない秒数は null（「不明」を intro に畳まない）', () => {
    expect(sectionAt(SECTIONS, 99)).toBeNull()
  })
})

describe('スタブ下書きの異常系', () => {
  it('Shot が 0 件の依頼は検証で落ちる（例外は reject で返す）', async () => {
    await expect(drafter.draft(aDraftRequest({ shots: [] }))).rejects.toThrow()
  })
})

/**
 * カメラの案（ADR-0043）。スタブは決定的なので、**同じ Shot からは必ず同じ案**が出る。
 * 一部は「提案なし」にしてあり、カメラを触らずに採用する経路も配線として通る。
 */
describe('スタブのカメラの案', () => {
  const shots = Array.from({ length: 12 }, (_unused, i) =>
    aDraftShot({ code: `CUT-${String(i + 1).padStart(2, '0')}`, order: (i + 1) * 1000 }),
  )

  it('同じ Shot からは同じ案が出る', () => {
    const first = shots.map((shot) => stubDraftItem(shot, []).camera)
    const again = shots.map((shot) => stubDraftItem(shot, []).camera)

    expect(again).toEqual(first)
  })

  it('提案ありと提案なしの両方が出る', () => {
    const cameras = shots.map((shot) => stubDraftItem(shot, []).camera)

    expect(cameras.some((camera) => camera === null)).toBe(true)
    expect(cameras.some((camera) => camera !== null)).toBe(true)
  })

  it('出す値はすべて選べる値（domain の検証を通る）', () => {
    for (const shot of shots) {
      const { camera } = stubDraftItem(shot, [])
      if (camera !== null) expect(StoryboardDraftCamera.safeParse(camera).success).toBe(true)
    }
  })
})
