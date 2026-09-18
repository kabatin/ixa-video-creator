import { ProjectId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_ID, SHOT_ID } from '@/__tests__/fixtures'
import { createCostMeterApi, WireCostMeter } from '@/lib/cost-meter-api'
import { createRequester } from '@/lib/requester'

/**
 * `GET /projects/{id}/cost` の呼び出し口（P63-2）。
 *
 * 検証したいのは「封筒を剥がして形を確かめているか」。
 * **件数が欠けた応答をそのまま通さない**ことが肝心で、
 * 件数が無いと画面は額だけを見せてしまう。
 */

const BASE_URL = 'http://127.0.0.1:3001'
const projectId = ProjectId.parse(PROJECT_ID)

const meterJson = {
  budgetUsd: 300,
  measured: { takeCount: 0, totalUsd: 0, byProvider: [] },
  stub: { takeCount: 50, totalUsd: 0 },
  byShot: [{ shotId: SHOT_ID, measuredUsd: 0, stubTakeCount: 2 }],
  unlistedShots: { takeCount: 0, measuredUsd: 0, stubUsd: 0 },
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const api = () => createCostMeterApi(createRequester(BASE_URL))

describe('費用メーターの取得', () => {
  it('projectId で引き、封筒を剥がしてパースする', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: meterJson }))

    const meter = await api().getCostMeter(projectId)

    expect(meter.stub.takeCount).toBe(50)
    expect(meter.measured.takeCount).toBe(0)
    expect(meter.byShot).toHaveLength(1)
    expect(meter.byShot[0]?.stubTakeCount).toBe(2)

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/cost`)
  })

  it('失敗の応答は握り潰さず例外にする', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: '見つかりません' }, 404))

    await expect(api().getCostMeter(projectId)).rejects.toThrow()
  })
})

describe('WireCostMeter の検証', () => {
  /** null は「未設定」。スキーマの時点で通す（L-021）。 */
  it('予算 null を受け付ける', () => {
    expect(WireCostMeter.parse({ ...meterJson, budgetUsd: null }).budgetUsd).toBeNull()
  })

  it('件数が欠けた応答を通さない', () => {
    expect(() =>
      WireCostMeter.parse({ ...meterJson, measured: { totalUsd: 0, byProvider: [] } }),
    ).toThrow()
  })

  it('負の額を通さない', () => {
    expect(() =>
      WireCostMeter.parse({
        ...meterJson,
        measured: { takeCount: 1, totalUsd: -1, byProvider: [] },
      }),
    ).toThrow()
  })

  /** Provider の名前は空文字を許さない。名前が空では載せ忘れに気付けない。 */
  it('名前の無い Provider を通さない', () => {
    expect(() =>
      WireCostMeter.parse({
        ...meterJson,
        measured: {
          takeCount: 1,
          totalUsd: 0,
          byProvider: [{ providerId: '', takeCount: 1, totalUsd: 0 }],
        },
      }),
    ).toThrow()
  })

  it('Provider の内訳が欠けた応答を通さない', () => {
    expect(() =>
      WireCostMeter.parse({ ...meterJson, measured: { takeCount: 0, totalUsd: 0 } }),
    ).toThrow()
  })

  it('内訳と合計の差の説明が欠けた応答を通さない', () => {
    expect(() =>
      WireCostMeter.parse({ ...meterJson, unlistedShots: undefined }),
    ).toThrow()
  })

  it('件数が小数の応答を通さない', () => {
    expect(() =>
      WireCostMeter.parse({ ...meterJson, stub: { takeCount: 1.5, totalUsd: 0 } }),
    ).toThrow()
  })

  /** Shot ごとのスタブ欄は**件数**。額が紛れ込んだら通さない。 */
  it('Shot ごとのスタブ件数が小数の応答を通さない', () => {
    expect(() =>
      WireCostMeter.parse({
        ...meterJson,
        byShot: [{ shotId: SHOT_ID, measuredUsd: 0, stubTakeCount: 1.5 }],
      }),
    ).toThrow()
  })

  it('ULID でない shotId を通さない', () => {
    expect(() =>
      WireCostMeter.parse({
        ...meterJson,
        byShot: [{ shotId: 'nope', measuredUsd: 0, stubTakeCount: 0 }],
      }),
    ).toThrow()
  })
})
