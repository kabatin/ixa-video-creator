import { describe, expect, it } from 'vitest'
import { declaredOutputSize } from '../generation/declared-output.js'
import type { Take } from '../generation/take.js'

/**
 * ADR-0045。レビューが「ファイルの大きさが申告どおりか」を見るのに使う。
 * **「生成した大きさ」（切り抜く前）と混ぜない。**
 */
const take = (providerParams: Take['providerParams']): Pick<Take, 'providerParams'> => ({
  providerParams,
})

describe('declaredOutputSize', () => {
  it('記録された出力の大きさを返す', () => {
    expect(
      declaredOutputSize(
        take({ kind: 'http', request: { output: { width: 1344, height: 756 } } }),
      ),
    ).toEqual({ width: 1344, height: 756 })
  })

  it('綴りの違う余分な鍵があっても読める（生成は mediaType・上げる口は media_type）', () => {
    expect(
      declaredOutputSize(
        take({
          kind: 'http',
          request: { output: { width: 832, height: 468, media_type: 'video/mp4', fps: 24 } },
        }),
      ),
    ).toEqual({ width: 832, height: 468 })
  })

  it('持ち込んだ Take には申告が無い', () => {
    expect(
      declaredOutputSize(take({ kind: 'import', sourceModel: null, fileName: null })),
    ).toBeNull()
  })

  it('記録に出力が無ければ null（推測で埋めない）', () => {
    expect(declaredOutputSize(take({ kind: 'http', request: {} }))).toBeNull()
  })

  it('大きさが数でなければ null', () => {
    expect(
      declaredOutputSize(
        take({ kind: 'http', request: { output: { width: '1344', height: 756 } } }),
      ),
    ).toBeNull()
  })

  it('0 や負の値は大きさとして認めない', () => {
    expect(
      declaredOutputSize(take({ kind: 'http', request: { output: { width: 0, height: 756 } } })),
    ).toBeNull()
  })

  it('生成した大きさ（切り抜く前）は申告として使わない', () => {
    expect(
      declaredOutputSize(
        take({
          kind: 'http',
          request: { generation: { width: 1344, height: 768 } },
        }),
      ),
    ).toBeNull()
  })
})
