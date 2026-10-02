import { describe, expect, it } from 'vitest'
import { lacksStoryboard } from '../generation/take-readiness.js'

/**
 * 説明も最初のフレームも無い Shot（制作者 2026-10-01「全然関係ない動画が生成されてしまう」）。
 * 1 件の生成と一括生成が同じ判定を使う。
 */
describe('lacksStoryboard', () => {
  it('説明も最初のフレームも無ければ true', () => {
    expect(lacksStoryboard({ description: '', hasStartFrame: false })).toBe(true)
    expect(lacksStoryboard({ description: '  \n ', hasStartFrame: false })).toBe(true)
  })

  it('どちらかがあれば false', () => {
    expect(lacksStoryboard({ description: '夕焼けの屋上で振り返る', hasStartFrame: false })).toBe(false)
    expect(lacksStoryboard({ description: '', hasStartFrame: true })).toBe(false)
  })
})
