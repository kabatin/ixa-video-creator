import { describe, expect, it } from 'vitest'
import { ProviderParams } from '../generation/take.js'
import { Shot, ShotTiming, UpdateShotPatch } from '../shot/shot.js'

/**
 * 手持ちの動画を Take にする・尺に合わせた速度（ADR-0026）。
 */
describe('ProviderParams の持ち込み', () => {
  it('どのモデルで作ったかを持てる（分からなければ null）', () => {
    expect(ProviderParams.parse({ kind: 'import', sourceModel: 'Veo 3.1 Lite（推定）', fileName: '01.mp4' })).toEqual({
      kind: 'import',
      sourceModel: 'Veo 3.1 Lite（推定）',
      fileName: '01.mp4',
    })
    expect(ProviderParams.parse({ kind: 'import', sourceModel: null, fileName: null }).kind).toBe('import')
  })
})

describe('Shot の timing', () => {
  it('既定は trim（今と同じ。長ければ切り、速度は変えない）', () => {
    expect(ShotTiming.options).toEqual(['trim', 'fit'])
    const parsed = Shot.shape.timing.parse(undefined)
    expect(parsed).toBe('trim')
  })

  it('あとから fit に変えられる', () => {
    expect(UpdateShotPatch.parse({ timing: 'fit' })).toEqual({ timing: 'fit' })
  })

  it('知らない値は弾く', () => {
    expect(UpdateShotPatch.safeParse({ timing: 'stretch' }).success).toBe(false)
  })
})
