import { describe, expect, it } from 'vitest'
import {
  CONTINUITY_HEAD_MARGIN_SEC,
  CONTINUITY_HEAD_SKIP_FRAMES,
  continuityFrameIndex,
  continuityHeadSkipSec,
} from '../shot/continuity.js'

/**
 * 「前の Shot から続ける」繋ぎ目（制作者 2026-10-24）。
 * 実測：H3 は 3.333 秒を頼むと 3.75 秒（90 コマ）作る。以前は次の Shot をファイル末尾の 0.1 秒手前から
 * 作っていたため、尺 3.333 秒では 10 コマ飛び、尺 3.75 秒では 2 コマ戻った。
 */
const take = { durationSec: 3.75, fps: 24 }
const shot = (durationSec: number, sourceInSec = 0, speed = 1) =>
  ({ timing: 'trim' as const, durationSec, sourceInSec, speed })

describe('continuityFrameIndex（前の Shot が画面に出す最後のコマ）', () => {
  it('3.333 秒に切った Shot は 80 コマ目（0 始まりで 79）で終わる', () => {
    expect(continuityFrameIndex(shot(3.333), take)).toBe(79)
  })

  it('Take を全部使う Shot は最後のコマ（89）', () => {
    expect(continuityFrameIndex(shot(3.75), take)).toBe(89)
  })

  it('切り出し位置の分だけ後ろへずれる', () => {
    expect(continuityFrameIndex(shot(3.625, 0.125), take)).toBe(89)
    expect(continuityFrameIndex(shot(2, 0.5), take)).toBe(59)
  })

  it('速めた Shot は速さを掛けた位置で終わる', () => {
    expect(continuityFrameIndex(shot(1.5, 0, 2), take)).toBe(71)
  })

  it('Take が足りない Shot は最後のコマで止まるので、最後のコマ', () => {
    expect(continuityFrameIndex(shot(5), take)).toBe(89)
  })

  it('コマの境目ちょうどの浮動小数の誤差で 1 コマずれない', () => {
    expect(continuityFrameIndex(shot(2.5), take)).toBe(59)
    expect(continuityFrameIndex(shot(0.1 + 0.2), { durationSec: 3, fps: 10 })).toBe(2)
  })
})

describe('continuityHeadSkipSec（次の Shot の頭で捨てる長さ）', () => {
  it('元のコマの写しと、動き出しの遅いコマを捨てる', () => {
    expect(CONTINUITY_HEAD_SKIP_FRAMES).toBe(2)
    expect(continuityHeadSkipSec(24)).toBeCloseTo(2 / 24, 9)
  })
})

describe('generationSecFor（前の Shot から続ける Shot は、頭で捨てるぶん長めに頼む）', () => {
  const vpipe = { mode: 'enum' as const, values: [2.333, 3.042, 3.75, 4.458] }

  it('尺がちょうど作れる長さでも、続ける Shot は 1 段長く頼む（頭を捨てても尺が足りる）', async () => {
    const { generationSecFor } = await import('../generation/duration.js')
    expect(generationSecFor({ ...shot(3.75), continuityMode: 'independent' }, vpipe)).toBe(3.75)
    expect(generationSecFor({ ...shot(3.75), continuityMode: 'previous_shot' }, vpipe)).toBe(4.458)
  })

  it('余裕がある尺は今までと同じ長さ', async () => {
    const { generationSecFor } = await import('../generation/duration.js')
    expect(generationSecFor({ ...shot(3.333), continuityMode: 'previous_shot' }, vpipe)).toBe(3.75)
  })

  it('捨てる余裕は 16fps の 2 コマ分（遅いモデルでも足りる）', () => {
    expect(CONTINUITY_HEAD_MARGIN_SEC).toBeCloseTo(2 / 16, 9)
  })
})

describe('continuitySourceInFor（続けて作った Take の頭を捨てる切り出し位置）', () => {
  const ref = (role: 'previous_shot_last_frame' | 'style') => ({ mediaAssetId: 'x', role, weight: 0.8 })

  it('前の Shot のコマから作った Take なら、2 コマ目の終わりから使う', async () => {
    const { continuitySourceInFor } = await import('../shot/continuity.js')
    expect(continuitySourceInFor(shot(3.333), { fps: 24, references: [ref('previous_shot_last_frame')] })).toBeCloseTo(2 / 24, 9)
  })

  it('前の Shot のコマを使っていなければ触らない', async () => {
    const { continuitySourceInFor } = await import('../shot/continuity.js')
    expect(continuitySourceInFor(shot(3.333), { fps: 24, references: [ref('style')] })).toBeNull()
  })

  it('制作者が既にそれ以上切っていれば触らない', async () => {
    const { continuitySourceInFor } = await import('../shot/continuity.js')
    expect(continuitySourceInFor(shot(3.333, 0.25), { fps: 24, references: [ref('previous_shot_last_frame')] })).toBeNull()
    expect(continuitySourceInFor(shot(3.333, 2 / 24), { fps: 24, references: [ref('previous_shot_last_frame')] })).toBeNull()
  })
})
