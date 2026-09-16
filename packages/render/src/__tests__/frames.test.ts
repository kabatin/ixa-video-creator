import { describe, expect, it, vi } from 'vitest'

/**
 * 秒→フレーム変換を **自前で書いていないこと**を構造的に検証するため、
 * `@ixa/domain` の `secondsToFrames` をスパイに差し替える。
 * 呼ばれていなければ、どこかで `Math.round(sec * fps)` を書き直している。
 */
vi.mock('@ixa/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ixa/domain')>()
  return { ...actual, secondsToFrames: vi.fn(actual.secondsToFrames) }
})

// vi.mock は import より前に巻き上げられるため、この位置の import で差し替え後の関数を受け取れる。
import { secondsToFrames } from '@ixa/domain'
import { buildTimelinePlan } from '../plan.js'
import { frameRange, sourceOffsetFrames, totalFrames } from '../timing.js'
import { makeDocument, makeVideo1Shot } from './fixtures.js'

const spy = vi.mocked(secondsToFrames)

describe('secondsToFrames への委譲', () => {
  it('frameRange は開始と終了の両方を secondsToFrames で丸める', () => {
    spy.mockClear()
    frameRange(1, 2, 30)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenNthCalledWith(1, 1, 30)
    expect(spy).toHaveBeenNthCalledWith(2, 3, 30)
  })

  it('sourceOffsetFrames は secondsToFrames を通す', () => {
    spy.mockClear()
    expect(sourceOffsetFrames(2.4, 25)).toBe(60)
    expect(spy).toHaveBeenCalledWith(2.4, 25)
  })

  it('totalFrames は secondsToFrames を通す', () => {
    spy.mockClear()
    expect(totalFrames(116, 30)).toBe(3480)
    expect(spy).toHaveBeenCalledWith(116, 30)
  })

  it('buildTimelinePlan も自前の変換を持たない', () => {
    spy.mockClear()
    buildTimelinePlan(
      makeDocument({ video1: [makeVideo1Shot(1, 0, 2)], durationSec: 2 }),
      { width: 1920, height: 1080 },
    )
    expect(spy).toHaveBeenCalled()
  })
})

describe('丸めは round（floor ではない）', () => {
  it('端数 0.5 以上は切り上がる', () => {
    // 0.99 * 30 = 29.7 → round は 30、floor なら 29 になる
    expect(frameRange(0, 0.99, 30).durationInFrames).toBe(30)
  })

  it('端数 0.5 未満は切り捨てられる', () => {
    // 0.98 * 30 = 29.4 → 29
    expect(frameRange(0, 0.98, 30).durationInFrames).toBe(29)
  })

  it('ちょうど 0.5 フレームは切り上がる', () => {
    expect(sourceOffsetFrames(0.5, 1)).toBe(1)
  })
})

describe('境界', () => {
  it('0 秒開始は 0 フレーム', () => {
    expect(frameRange(0, 1, 30).from).toBe(0)
  })

  it('尺 0 でも 1 フレームは確保する（Remotion は 0 フレームを拒否する）', () => {
    expect(frameRange(3, 0, 30)).toEqual({ from: 90, durationInFrames: 1 })
  })

  it('尺 0 のタイムラインでも 1 フレーム', () => {
    expect(totalFrames(0, 30)).toBe(1)
  })

  it('隣接する Shot の間にすき間も重なりも作らない', () => {
    // 端数を持つ境界（1.0166 秒）で、尺だけを独立に丸めるとずれる
    const a = frameRange(0, 1.0166, 30)
    const b = frameRange(1.0166, 1.0166, 30)
    expect(a.from + a.durationInFrames).toBe(b.from)
    expect(b.from).toBe(30)
  })

  it('非整数 fps でも round で一貫する', () => {
    expect(frameRange(0, 1, 23.976).durationInFrames).toBe(24)
  })
})
