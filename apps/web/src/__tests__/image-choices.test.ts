import type { ShotId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { imageChoicesFor } from '@/components/workbench/use-image-attach'

/**
 * 画像を落としたときの入れ先（ADR-0025）。Shot を見ているときは、その Shot の
 * 最初のフレームにできる（画像から動画で Take にするため）。
 */
describe('imageChoicesFor', () => {
  it('Shot を見ているときは、最初のフレームにする選択肢を先頭に出す', () => {
    const choices = imageChoicesFor({ kind: 'shot', id: 'shot-1' as ShotId })

    expect(choices[0]).toEqual({
      label: 'いま選んでいる Shot の最初のフレームにする',
      target: { kind: 'shot', id: 'shot-1' },
    })
  })

  /**
   * 1 枚の画像からキャラクターシートを作る（ADR-0035。制作者 2026-10-03「キャラクターアップする時の機能に取り入れられると
   * いい」）。新しいキャラクターにして、その画像を手本にシートを作り始める。
   * シートを作らずに入れる選択肢も残す（制作者 2026-10-03「キャラクターシートを作成せずにキャラクター画像を入れる選択肢がない」）。
   */
  it('何も見ていなければ、新しいキャラクター（画像だけ・シートも作る）・ロケーション・ブランド資産', () => {
    const choices = imageChoicesFor(null)
    expect(choices.map((c) => c.target.kind)).toEqual([
      'new-character',
      'new-character-sheet',
      'new-location',
      'new-brand-asset',
    ])
    expect(choices[0]?.label).toBe('新しいキャラクターにする')
    expect(choices[1]?.label).toBe('新しいキャラクターにする（キャラクターシートも作る）')
  })

  it('キャラクターを見ているときは、そのキャラクターに入れる', () => {
    expect(imageChoicesFor({ kind: 'character', id: 'c1' } as never)[0]?.label).toBe(
      'いま選んでいるキャラクターに入れる',
    )
  })
})
