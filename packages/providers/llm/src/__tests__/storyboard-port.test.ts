import { ShotId as ShotIdSchema, newId, type ShotId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  MAX_LISTED_SHOT_IDS,
  StoryboardDraftRequest,
  StoryboardDraftResponse,
  checkDraftedShotIds,
} from '../storyboard-port.js'
import { aDraftRequest, aDraftShot, aDraftedItem } from './draft-fixtures.js'

/**
 * 依頼した Shot と返ってきた案の突き合わせ（P63-4）。
 *
 * **ここが素通りすると「27 件頼んだのに 18 件しか出ない」が成功に化ける。**
 * 実装 3 つ（CLI / スタブ / 呼び出し側）が同じ判定を使うので、判定そのものを固定する。
 */

const anId = (): ShotId => newId(ShotIdSchema)
const ids = (count: number): readonly ShotId[] => Array.from({ length: count }, anId)

describe('checkDraftedShotIds', () => {
  it('過不足なく一致すれば null を返す', () => {
    const a = anId()
    const b = anId()
    expect(checkDraftedShotIds([a, b], [b, a])).toBeNull()
  })

  it('依頼した Shot の案が足りなければ missing_shot_id で落とす', () => {
    const a = anId()
    const result = checkDraftedShotIds([a, anId(), anId()], [a])

    expect(result?.code).toBe('missing_shot_id')
    // **件数を必ず文に残す。** 何件落ちたかが無いと、失敗の大きさが分からない。
    expect(result?.message).toContain('3 件のうち 2 件')
  })

  it('依頼していない Shot が混ざれば unknown_shot_id で落とす', () => {
    const a = anId()
    const stranger = anId()
    const result = checkDraftedShotIds([a], [a, stranger])

    expect(result?.code).toBe('unknown_shot_id')
    expect(result?.message).toContain(stranger)
  })

  it('同じ Shot に 2 つの案が返れば duplicate_shot_id で落とす（DB の一意制約に当たる前に）', () => {
    const a = anId()
    expect(checkDraftedShotIds([a], [a, a])?.code).toBe('duplicate_shot_id')
  })

  it('空の応答は「全件足りない」として落とす（成功にしない）', () => {
    const result = checkDraftedShotIds(ids(4), [])

    expect(result?.code).toBe('missing_shot_id')
    expect(result?.message).toContain('4 件のうち 4 件')
  })

  it('落ちた件数が多いときは先頭だけ並べ、残りを件数で示す', () => {
    const result = checkDraftedShotIds(ids(MAX_LISTED_SHOT_IDS + 3), [])

    expect(result?.message).toContain('ほか 3 件')
  })

  it('重複は不足より先に見る（重複したまま件数だけ合う応答を通さない）', () => {
    const a = anId()
    expect(checkDraftedShotIds([a, anId()], [a, a])?.code).toBe('duplicate_shot_id')
  })
})

describe('StoryboardDraftRequest', () => {
  it('Shot が 0 件の依頼は通さない（下書きする対象が無い）', () => {
    expect(StoryboardDraftRequest.safeParse(aDraftRequest({ shots: [] })).success).toBe(false)
  })

  it('脚本も解析も無い Project の依頼は通す', () => {
    const parsed = StoryboardDraftRequest.safeParse(
      aDraftRequest({ script: null, sections: [] }),
    )
    expect(parsed.success).toBe(true)
  })

  it('Shot の並びはそのまま保つ（順番を入れ替えない）', () => {
    const shots = [
      aDraftShot({ code: 'A', order: 1000 }),
      aDraftShot({ code: 'B', order: 2000 }),
    ]
    const parsed = StoryboardDraftRequest.parse(aDraftRequest({ shots }))
    expect(parsed.shots.map((shot) => shot.code)).toEqual(['A', 'B'])
  })
})

describe('StoryboardDraftResponse', () => {
  const shotId = newId(ShotIdSchema)

  it('reason の無い案は通さない（採否を判断できない）', () => {
    const { reason: _reason, ...withoutReason } = aDraftedItem(shotId)
    const parsed = StoryboardDraftResponse.safeParse({ items: [withoutReason] })

    expect(parsed.success).toBe(false)
  })

  it('description が上限を超える案は通さない（保存時ではなく入口で落とす）', () => {
    const parsed = StoryboardDraftResponse.safeParse({
      items: [aDraftedItem(shotId, { description: 'あ'.repeat(401) })],
    })
    expect(parsed.success).toBe(false)
  })

  it('reason が上限を超える案も通さない', () => {
    const parsed = StoryboardDraftResponse.safeParse({
      items: [aDraftedItem(shotId, { reason: 'い'.repeat(401) })],
    })
    expect(parsed.success).toBe(false)
  })

  it('mood は null を許す（雰囲気を決めないのは正当な案）', () => {
    const parsed = StoryboardDraftResponse.safeParse({
      items: [aDraftedItem(shotId, { mood: null })],
    })
    expect(parsed.success).toBe(true)
  })

  it('ULID でない shotId は通さない', () => {
    const parsed = StoryboardDraftResponse.safeParse({
      items: [{ ...aDraftedItem(shotId), shotId: 'not-a-ulid' }],
    })
    expect(parsed.success).toBe(false)
  })
})
