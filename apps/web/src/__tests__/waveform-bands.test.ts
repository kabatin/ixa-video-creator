import { describe, expect, it } from 'vitest'
import {
  sectionStripes,
  seriesColumns,
  stretchBands,
  stretchSeries,
} from '@/lib/waveform-bands'

/**
 * 3 帯域の波形（PHASE 8.1）。**音圧を揃えた曲でも起伏が出ること**を固定する。
 * 本制作の曲は振幅の 90% が 0.71〜0.77 に収まり、そのまま描くと平らな四角だった。
 */

describe('stretchSeries', () => {
  it('狭い幅に詰まった値を 0..1 に引き伸ばす', () => {
    const flat = Array.from({ length: 100 }, (_, i) => 0.71 + (i % 7) * 0.01)
    const out = stretchSeries(flat)
    expect(Math.min(...out)).toBe(0)
    expect(Math.max(...out)).toBe(1)
  })

  it('外れ値 1 点で全体を潰さない（上下 2% を捨てる）', () => {
    const values = [...Array.from({ length: 99 }, (_, i) => 0.4 + (i % 10) * 0.02), 1]
    const out = stretchSeries(values)
    // 外れ値以外も 0..1 に広く散る（外れ値に合わせると 0.4〜0.6 に潰れる）
    const spread = Math.max(...out.slice(0, 99)) - Math.min(...out.slice(0, 99))
    expect(spread).toBeGreaterThan(0.9)
  })

  it('全部同じ値なら 0.5 に揃える（0 除算で壊さない）', () => {
    expect(stretchSeries([0.7, 0.7, 0.7])).toEqual([0.5, 0.5, 0.5])
  })

  it('入力を変えない', () => {
    const input = [0.1, 0.5, 0.9]
    stretchSeries(input)
    expect(input).toEqual([0.1, 0.5, 0.9])
  })

  it('空は空', () => {
    expect(stretchSeries([])).toEqual([])
  })
})

describe('stretchBands', () => {
  it('帯域ごとに引き伸ばす', () => {
    const out = stretchBands({ rms: [0.3, 0.4], low: [0.01, 0.02], mid: [0.5, 0.9], high: [0, 1] })
    expect(out.low).toEqual([0, 1])
    expect(out.mid).toEqual([0, 1])
  })
})

describe('seriesColumns', () => {
  const view = { startSec: 0, endSec: 4 }

  it('1 列に複数の点が入れば平均', () => {
    expect(seriesColumns([0, 1, 1, 1], view, 4, 2)).toEqual([0.5, 1])
  })

  it('点より列が多ければ近い点を使う', () => {
    expect(seriesColumns([0.2, 0.8], view, 4, 4)).toEqual([0.2, 0.2, 0.8, 0.8])
  })

  it('尺や列数が 0 なら空', () => {
    expect(seriesColumns([1], view, 0, 10)).toEqual([])
    expect(seriesColumns([1], view, 4, 0)).toEqual([])
  })
})

describe('sectionStripes', () => {
  it('境目で区切って交互に番号を振る', () => {
    expect(sectionStripes([2, 5], 8)).toEqual([
      [0, 2, 0],
      [2, 5, 1],
      [5, 8, 0],
    ])
  })

  it('範囲外の境目は無視する', () => {
    expect(sectionStripes([0, 9], 8)).toEqual([[0, 8, 0]])
  })
})
