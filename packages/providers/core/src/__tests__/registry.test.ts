import { describe, expect, it } from 'vitest'
import { UnknownModelError, createProviderRegistry } from '../registry.js'
import type { VideoProvider } from '../provider.js'
import { makeModel, modelId, providerId } from './fixtures.js'

const stubProvider = (id: string, modelIds: string[]): VideoProvider => ({
  id: providerId(id),
  models: modelIds.map((m) => makeModel({ id: m, providerId: id })),
  submit: () => Promise.reject(new Error('未実装')),
  poll: () => Promise.reject(new Error('未実装')),
  cancel: () => Promise.reject(new Error('未実装')),
})

describe('createProviderRegistry', () => {
  it('全 Provider のモデルを横断して引ける', () => {
    const r = createProviderRegistry([stubProvider('p1', ['a', 'b']), stubProvider('p2', ['c'])])
    expect(r.allModels()).toHaveLength(3)
    expect(r.findModel(modelId('c')).providerId).toBe(providerId('p2'))
    expect(r.providerFor(modelId('a')).id).toBe(providerId('p1'))
  })

  it('未登録のモデルは UnknownModelError', () => {
    const r = createProviderRegistry([stubProvider('p1', ['a'])])
    expect(() => r.findModel(modelId('zzz'))).toThrow(UnknownModelError)
    expect(() => r.providerFor(modelId('zzz'))).toThrow(UnknownModelError)
  })

  it('モデル ID の重複を起動時に検出する', () => {
    expect(() => createProviderRegistry([stubProvider('p1', ['dup']), stubProvider('p2', ['dup'])]))
      .toThrow(/重複/)
  })

  it('Provider の有無を判定できる', () => {
    const r = createProviderRegistry([stubProvider('p1', ['a'])])
    expect(r.hasProvider(providerId('p1'))).toBe(true)
    expect(r.hasProvider(providerId('nope'))).toBe(false)
  })
})
