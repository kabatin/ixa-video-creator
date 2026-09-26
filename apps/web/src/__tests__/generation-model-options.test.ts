import { describe, expect, it } from 'vitest'
import { AUTO_MODEL, generateBlocker, modelOptionsFrom } from '@/lib/generation-options'
import type { WireVideoModel } from '@/lib/models-api'

/**
 * 生成のモデル選択（ADR-0025）。以前は AUTO だけの固定で、登録したモデルを選べなかった。
 * 選択肢は `GET /models` から作る（画面にモデルの性質を書き写さない）。
 */

const model = (overrides: Partial<WireVideoModel>): WireVideoModel =>
  ({
    id: 'stub/veo-like',
    providerId: 'stub',
    label: 'Stub (Veo-like)',
    requiresStartFrame: false,
    routable: true,
    costPerSecondUsd: 0,
    ...overrides,
  }) as WireVideoModel

const local = model({ id: 'local/still-motion', providerId: 'local', label: '画像から動画（ローカル・無料）', requiresStartFrame: true, routable: false })

describe('modelOptionsFrom', () => {
  it('先頭は AUTO、続けて登録されているモデル', () => {
    const options = modelOptionsFrom([model({}), local])

    expect(options.map((o) => o.value)).toEqual([AUTO_MODEL, 'stub/veo-like', 'local/still-motion'])
    expect(options[2]?.label).toContain('画像から動画')
  })

  it('一覧がまだ読めていなければ AUTO だけ', () => {
    expect(modelOptionsFrom(null).map((o) => o.value)).toEqual([AUTO_MODEL])
  })
})

describe('generateBlocker', () => {
  it('最初のフレームが要るモデルで画像が無ければ、押す前に理由を言う', () => {
    expect(generateBlocker(local, false)).toContain('最初のフレーム')
  })

  it('画像があれば押せる', () => {
    expect(generateBlocker(local, true)).toBeNull()
  })

  it('AUTO や要らないモデルは画像が無くても押せる', () => {
    expect(generateBlocker(null, false)).toBeNull()
    expect(generateBlocker(model({}), false)).toBeNull()
  })
})
