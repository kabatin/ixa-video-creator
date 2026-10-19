import { describe, expect, it } from 'vitest'
import { frameEnergy, stripFrameTimes } from '../frame-energy.js'

/** 灰色の rawvideo から動きの強さの列を作る（ADR-0054 §2）。 */

const frame = (value: number, size = 4): number[] => Array.from({ length: size }, () => value)

describe('frameEnergy', () => {
  it('隣のコマとの差の平均を 0〜1 で返し、先頭は 0', () => {
    const bytes = Uint8Array.from([...frame(0), ...frame(255), ...frame(255), ...frame(51)])
    expect(frameEnergy(bytes, 2, 2)).toEqual([0, 1, 0, 0.8])
  })

  it('半端なバイト（最後のコマが欠けている）は捨てる', () => {
    const bytes = Uint8Array.from([...frame(0), ...frame(255), 1, 2])
    expect(frameEnergy(bytes, 2, 2)).toEqual([0, 1])
  })

  it('コマが無ければ空', () => {
    expect(frameEnergy(new Uint8Array(0), 2, 2)).toEqual([])
  })

  it('コマの大きさが正でなければ投げる', () => {
    expect(() => frameEnergy(new Uint8Array(4), 0, 2)).toThrow()
  })
})

describe('stripFrameTimes', () => {
  it('Take を等間隔に分け、各区間の真ん中の時刻を返す', () => {
    expect(stripFrameTimes(4, 4)).toEqual([0.5, 1.5, 2.5, 3.5])
  })

  it('長さが正でなければ空', () => {
    expect(stripFrameTimes(0, 4)).toEqual([])
  })
})
