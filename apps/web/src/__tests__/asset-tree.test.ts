import { describe, expect, it } from 'vitest'
import { matchesAssetQuery } from '@/lib/asset-tree'

describe('matchesAssetQuery', () => {
  it('空の検索語はすべてに当たる', () => {
    expect(matchesAssetQuery('ロケーション', '')).toBe(true)
    expect(matchesAssetQuery('ロケーション', '   ')).toBe(true)
  })

  it('部分一致で当たる', () => {
    expect(matchesAssetQuery('ブランド資産', '資産')).toBe(true)
    expect(matchesAssetQuery('ブランド資産', '楽曲')).toBe(false)
  })

  it('大文字小文字・全角半角を区別しない', () => {
    expect(matchesAssetQuery('Hero A', 'hero')).toBe(true)
    expect(matchesAssetQuery('ＨＥＲＯ', 'hero')).toBe(true)
    expect(matchesAssetQuery('ｶﾒﾗ', 'カメラ')).toBe(true)
  })
})
