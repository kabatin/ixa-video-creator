import { describe, expect, it } from 'vitest'
import { MAX_TAG_LENGTH, addTag, removeTagAt } from '@/lib/tag-input'

describe('addTag', () => {
  it('末尾へ追加し、並び順を保つ', () => {
    const first = addTag([], '20代日本人男性')
    expect(first.ok && first.tags).toEqual(['20代日本人男性'])

    const second = addTag(['20代日本人男性'], '細身')
    expect(second.ok && second.tags).toEqual(['20代日本人男性', '細身'])
  })

  it('前後の空白を落として追加する', () => {
    const result = addTag([], '  切れ長の鋭い目  ')
    expect(result.ok && result.tags).toEqual(['切れ長の鋭い目'])
  })

  it('空文字と空白だけの入力を弾く', () => {
    expect(addTag([], '').ok).toBe(false)
    expect(addTag([], '   ').ok).toBe(false)
  })

  it('重複を弾く', () => {
    const result = addTag(['細身'], '細身')
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason).toContain('同じ値')
  })

  it('空白を落とした結果が重複する場合も弾く', () => {
    expect(addTag(['細身'], ' 細身 ').ok).toBe(false)
  })

  it('長すぎる値を弾く', () => {
    expect(addTag([], 'あ'.repeat(MAX_TAG_LENGTH)).ok).toBe(true)
    expect(addTag([], 'あ'.repeat(MAX_TAG_LENGTH + 1)).ok).toBe(false)
  })

  it('元の配列を変更しない', () => {
    const tags = ['細身']
    addTag(tags, '硬質な光')
    expect(tags).toEqual(['細身'])
  })
})

describe('removeTagAt', () => {
  it('指定位置だけを取り除き、残りの順序を保つ', () => {
    expect(removeTagAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c'])
  })

  it('範囲外はそのまま返す', () => {
    expect(removeTagAt(['a', 'b'], 5)).toEqual(['a', 'b'])
    expect(removeTagAt(['a', 'b'], -1)).toEqual(['a', 'b'])
  })

  it('元の配列を変更しない', () => {
    const tags = ['a', 'b']
    removeTagAt(tags, 0)
    expect(tags).toEqual(['a', 'b'])
  })
})
