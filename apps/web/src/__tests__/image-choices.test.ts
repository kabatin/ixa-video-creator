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

  it('何も見ていなければ、新しいロケーション・ブランド資産だけ', () => {
    expect(imageChoicesFor(null).map((c) => c.target.kind)).toEqual(['new-location', 'new-brand-asset'])
  })

  it('キャラクターを見ているときは、そのキャラクターに入れる', () => {
    expect(imageChoicesFor({ kind: 'character', id: 'c1' } as never)[0]?.label).toBe(
      'いま選んでいるキャラクターに入れる',
    )
  })
})
