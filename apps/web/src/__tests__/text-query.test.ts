import { describe, expect, it } from 'vitest'
import { matchesTextQuery, normalizeQueryText } from '@/lib/text-query'

/**
 * 名前の検索の揃え方（素材ツリーと作品一覧で同じ）。全角・半角、大文字・小文字、前後の空白で見つからない、を起こさない。
 */
describe('normalizeQueryText', () => {
  it('全角・半角と大文字・小文字を揃え、前後の空白を落とす', () => {
    expect(normalizeQueryText('  ＮＩＧＨＴ Run ')).toBe('night run')
    expect(normalizeQueryText('ｶﾒﾗ')).toBe('カメラ')
  })
})

describe('matchesTextQuery', () => {
  it('全角の「ＮＩＧＨＴ」で「NIGHT RUN」が見つかる', () => {
    expect(matchesTextQuery('NIGHT RUN', 'ＮＩＧＨＴ')).toBe(true)
    expect(matchesTextQuery('NIGHT RUN', 'night')).toBe(true)
  })

  it('かな・漢字の途中の一部でも見つかる', () => {
    expect(matchesTextQuery('進め！戦子ちゃん！', '戦子')).toBe(true)
    expect(matchesTextQuery('進め！戦子ちゃん！', 'ちゃん')).toBe(true)
    expect(matchesTextQuery('進め！戦子ちゃん！', '夜明け')).toBe(false)
  })

  it('空の検索語（空白だけも）はすべてに当たる', () => {
    expect(matchesTextQuery('NIGHT RUN', '')).toBe(true)
    expect(matchesTextQuery('NIGHT RUN', '   ')).toBe(true)
  })
})
