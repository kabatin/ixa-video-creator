import { describe, expect, it } from 'vitest'
import {
  MAX_WAVEFORM_HEIGHT_PX,
  MIN_WAVEFORM_HEIGHT_PX,
  fillWaveformHeight,
  shouldResizeWaveform,
} from '@/lib/waveform-fill'

/**
 * 波形はパネルの余りをもらう（§5.2）。
 *
 * 以前は 78px の固定で、**パネルを縦に広げても波形は変わらなかった**。
 * 増えるのは下のフォームの余白だけで、聴きながら区切りを置くという
 * いちばん精度が要る作業にいちばんピクセルが無かった（実測: 本文 396px 中 78px）。
 *
 * 埋める向きに直したことが一度戻っている。理由は**下の操作列が画面外へ出た**こと。
 * だから「広がる」だけでなく「狭いときに下限で止まる」ほうも固定する。
 */
describe('fillWaveformHeight', () => {
  /** 波形以外が 300px ある想定。中身の高さ = 300 + いまの波形。 */
  const others = 300
  const at = (bodyClientHeight: number, currentHeight: number): number =>
    fillWaveformHeight({
      bodyClientHeight,
      contentHeight: others + currentHeight,
      currentHeight,
    })

  it('余りがあればそのぶん広がる', () => {
    expect(at(600, 96)).toBe(300)
  })

  it('パネルを広げるほど広がる', () => {
    expect(at(700, 300)).toBeGreaterThan(at(600, 300))
  })

  it('狭いときは下限で止まる（下の操作を押し出さない）', () => {
    expect(at(320, 96)).toBe(MIN_WAVEFORM_HEIGHT_PX)
  })

  it('広すぎても上限で止まる', () => {
    expect(at(4000, 96)).toBe(MAX_WAVEFORM_HEIGHT_PX)
  })

  it('測れていないときは今の値を保つ', () => {
    expect(fillWaveformHeight({ bodyClientHeight: 0, contentHeight: 400, currentHeight: 120 })).toBe(
      120,
    )
    expect(fillWaveformHeight({ bodyClientHeight: 400, contentHeight: 0, currentHeight: 120 })).toBe(
      120,
    )
  })

  /**
   * **入れ物の高さを渡すと測れない。** `scrollHeight` は余裕があるとき入れ物と
   * 同じ値を返すので、「中身の高さ」のつもりで渡すと余りが常に 0 になり、
   * 広げても波形が下限のまま動かない（実際にそうなった）。
   */
  it('中身の高さが入れ物と同じなら、余りは生まれない', () => {
    expect(fillWaveformHeight({ bodyClientHeight: 696, contentHeight: 696, currentHeight: 94 })).toBe(
      MIN_WAVEFORM_HEIGHT_PX,
    )
  })
})

describe('shouldResizeWaveform', () => {
  it('わずかな揺れでは描き直さない', () => {
    expect(shouldResizeWaveform(200, 202)).toBe(false)
  })

  it('はっきり変わったら描き直す', () => {
    expect(shouldResizeWaveform(200, 260)).toBe(true)
  })
})
