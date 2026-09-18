import { describe, expect, it } from 'vitest'
import { ShotId, TakeId, newId } from '../common/ids.js'

/**
 * **ID は同じミリ秒でも必ず増える。**
 *
 * `orderBy(desc(id))` で「最新の 1 件」を引く口がいくつもある
 * （ReviewRun / GenerationJob / StoryboardDraftRun）。素の `ulid()` は同じ
 * ミリ秒だと乱数部がそのつど独立なので、続けて作った 2 件の大小が入れ替わり、
 * **作り直した直後に古い方が「最新」として返る。**
 * 実際に絵コンテ下書きのテストが CI で落ちて分かった（2026-09-18）。
 */
describe('newId', () => {
  it('続けて発行すると必ず増える（同じミリ秒でも入れ替わらない）', () => {
    // 1 ミリ秒に十分収まる数を、時間を置かずに発行する。
    const ids = Array.from({ length: 2000 }, () => newId(ShotId))

    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /** 型（ブランド）が違っても発行器は 1 つ。混ぜても順序は保たれる。 */
  it('別の種類の ID を混ぜても順序が保たれる', () => {
    const ids = Array.from({ length: 500 }, (_, i) =>
      i % 2 === 0 ? String(newId(ShotId)) : String(newId(TakeId)),
    )

    expect(ids).toEqual([...ids].sort())
  })

  it('ULID の形（26 文字）である', () => {
    expect(newId(ShotId)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })
})
