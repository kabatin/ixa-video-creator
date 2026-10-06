import { createProviderRegistry } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import {
  createLocalVideoProviders,
  localVideoServerWirings,
  type LocalVideoServersInput,
} from '../local-video-servers.js'
import { createStubVideoProvider } from '../stub/provider.js'
import { VPIPE_H3_TURBO_DRAFT_MODEL_ID, VPIPE_H3_TURBO_MODEL_ID } from '../vpipe/descriptor.js'
import { WAN_TI2V_5B_DRAFT_MODEL_ID, WAN_TI2V_5B_MODEL_ID } from '../wan/descriptor.js'
import { createFetch, healthBody, jsonResponse } from './local-server-fixtures.js'

/**
 * `.env` の値 → どの Provider を登録するか（ADR-0040）。
 *
 * **この表が 1 か所であることが大事。** 以前は同じ条件が API（`main.ts`）と worker
 * （`generation-wiring.ts`）に書き写されていて、片方だけ直すと
 * 「API のモデル一覧には出るのに worker が未登録のモデルとして落とす」になった。
 */

const settings = (enabled: LocalVideoServersInput['enabled']): LocalVideoServersInput => ({
  enabled,
  vpipe: { baseUrl: 'http://127.0.0.1:8765', token: null },
  wan: { baseUrl: 'http://127.0.0.1:8766', token: null },
})

const providersFor = (enabled: LocalVideoServersInput['enabled']) =>
  createLocalVideoProviders({ ...settings(enabled), outputRoot: '/tmp/ixa-test-output' })

describe('有効にしたサーバだけ登録する', () => {
  it('既定（何も書いていない）では 1 つも登録しない', () => {
    expect(providersFor([])).toEqual([])
  })

  it('vpipe だけなら MiniMax H3 の 2 つだけが出る', () => {
    const providers = providersFor(['vpipe'])
    expect(providers.map((p) => p.id)).toEqual(['vpipe'])
    expect(providers.flatMap((p) => p.models.map((m) => m.id))).toEqual([
      VPIPE_H3_TURBO_DRAFT_MODEL_ID,
      VPIPE_H3_TURBO_MODEL_ID,
    ])
  })

  it('wan だけなら Wan 2.2 の 2 つだけが出る（H3 は出ない）', () => {
    const providers = providersFor(['wan'])
    expect(providers.map((p) => p.id)).toEqual(['wan'])
    expect(providers.flatMap((p) => p.models.map((m) => m.id))).toEqual([
      WAN_TI2V_5B_DRAFT_MODEL_ID,
      WAN_TI2V_5B_MODEL_ID,
    ])
  })

  it('両方書けば両方登録する（置き換えではない）', () => {
    expect(providersFor(['vpipe', 'wan']).map((p) => p.id)).toEqual(['vpipe', 'wan'])
  })

  it('どちらもこの機械の GPU を名乗る（worker が 1 本ずつに揃える根拠）', () => {
    for (const provider of providersFor(['vpipe', 'wan'])) {
      expect(provider.exclusiveResource).toBe('local-gpu')
    }
  })
})

describe('モデルからの行き先', () => {
  /** モデル ID を渡したら、その Provider に届くこと（スタブや fal を巻き込まない）。 */
  it('H3 のモデルは vpipe へ、Wan のモデルは wan へ届く', () => {
    const registry = createProviderRegistry([
      createStubVideoProvider({ outputDir: '/tmp/ixa-test-output/stub' }),
      ...providersFor(['vpipe', 'wan']),
    ])

    expect(registry.providerFor(VPIPE_H3_TURBO_DRAFT_MODEL_ID).id).toBe('vpipe')
    expect(registry.providerFor(VPIPE_H3_TURBO_MODEL_ID).id).toBe('vpipe')
    expect(registry.providerFor(WAN_TI2V_5B_DRAFT_MODEL_ID).id).toBe('wan')
    expect(registry.providerFor(WAN_TI2V_5B_MODEL_ID).id).toBe('wan')
  })

  it('モデル ID が重複していない（登録が落ちない）', () => {
    expect(() => createProviderRegistry([...providersFor(['vpipe', 'wan'])])).not.toThrow()
  })

  /** 有効にしていないサーバのモデルは「未登録のモデル」になる（黙って別の AI で作らない）。 */
  it('有効にしていないサーバのモデルは引けない', () => {
    const registry = createProviderRegistry([...providersFor(['vpipe'])])
    expect(() => registry.providerFor(WAN_TI2V_5B_MODEL_ID)).toThrow()
  })
})

describe('サーバの生存確認', () => {
  it('サーバごとの URL を叩く（片方の起動でもう片方を「使える」にしない）', async () => {
    const wirings = localVideoServerWirings(settings(['vpipe', 'wan']))
    const calls: string[] = []
    const probe = async (id: 'vpipe' | 'wan'): Promise<void> => {
      const wiring = wirings.find((w) => w.id === id)
      if (wiring === undefined) throw new Error(`${id} の配線がありません`)
      // health は配線が持つ URL を使う。ここでは呼ばれた URL だけ見たいので、素の fetch を差し替える。
      const original = globalThis.fetch
      const { fetch } = createFetch((url) => {
        calls.push(url)
        return jsonResponse(200, healthBody())
      })
      globalThis.fetch = fetch as unknown as typeof globalThis.fetch
      try {
        await wiring.checkHealth()
      } finally {
        globalThis.fetch = original
      }
    }

    await probe('vpipe')
    await probe('wan')

    expect(calls).toEqual([
      'http://127.0.0.1:8765/v1/health',
      'http://127.0.0.1:8766/v1/health',
    ])
  })

  it('有効にしていないサーバも一覧には出る（「有効にしてから選べます」と言うため）', () => {
    const wirings = localVideoServerWirings(settings(['wan']))
    expect(wirings.map((w) => [w.id, w.enabled])).toEqual([
      ['vpipe', false],
      ['wan', true],
    ])
  })
})
