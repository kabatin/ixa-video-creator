import { describe, expect, it } from 'vitest'
import { finalTierModelOf, type TieredModel } from '../generation/quality-tier.js'

/**
 * 「本番で作り直す」が使うモデルの選び方（ADR-0042）。
 *
 * **モデル ID を書き写さない。** 宣言された段（`qualityTier`）から引く。
 * ここを間違えると、頼んだのと違う AI で課金つきの生成が走る。
 */

const model = (
  id: string,
  providerId: string,
  qualityTier?: TieredModel['qualityTier'],
): TieredModel => ({
  id,
  providerId,
  ...(qualityTier === undefined ? {} : { qualityTier }),
})

const VPIPE_DRAFT = model('vpipe/h3-draft', 'vpipe', 'draft')
const VPIPE_FINAL = model('vpipe/h3-final', 'vpipe', 'final')
const FAL_FINAL = model('fal/kling-final', 'fal', 'final')
const NO_TIER = model('fal/kling', 'fal')

describe('finalTierModelOf', () => {
  it('同じ Provider の本番を返す', () => {
    expect(finalTierModelOf([VPIPE_DRAFT, VPIPE_FINAL], VPIPE_DRAFT.id)).toBe(VPIPE_FINAL)
  })

  /**
   * **別の Provider の本番に逃がさない。** 逃がすと、頼んだのと違う AI で
   * 課金つきの生成が走り、できた動画を見るまで誰も気づけない。
   */
  it('その Provider に本番が無ければ null（他の Provider の本番は返さない）', () => {
    expect(finalTierModelOf([VPIPE_DRAFT, FAL_FINAL], VPIPE_DRAFT.id)).toBeNull()
  })

  it('元のモデルが一覧に無ければ null', () => {
    expect(finalTierModelOf([VPIPE_FINAL], 'vpipe/知らないモデル')).toBeNull()
  })

  /**
   * **段を宣言していないモデルからは作り直さない。** 同じ Provider に本番があっても、
   * それが同じ系列とは限らない（別系列の本番に飛ぶと、絵がまるごと変わる）。
   */
  it('元が段を持たなければ、同じ Provider に本番があっても null', () => {
    expect(finalTierModelOf([NO_TIER, FAL_FINAL], NO_TIER.id)).toBeNull()
  })

  it('段を持たないモデルだけなら null', () => {
    expect(finalTierModelOf([NO_TIER], NO_TIER.id)).toBeNull()
  })

  /** 既に本番ならそれ自身。「作り直す必要が無い」の判定は呼ぶ側が持つ。 */
  it('元が本番なら、それ自身を返す', () => {
    expect(finalTierModelOf([VPIPE_DRAFT, VPIPE_FINAL], VPIPE_FINAL.id)).toBe(VPIPE_FINAL)
  })

  it('一覧が空なら null', () => {
    expect(finalTierModelOf([], VPIPE_DRAFT.id)).toBeNull()
  })
})
