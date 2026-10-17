import { ShotId, Take } from '@ixa/domain'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TakeComparePanel } from '@/components/take-compare-panel'
import { SHOT_ID, takeJson } from './fixtures'

/**
 * Take 比較の材料（中の URL は 1 時間）の取り直し（2026-10-18）。
 * 期限の前の取り直しが 1 回落ちただけで、映っている比較を消して赤字にし、そのあと二度と取り直さなかった。
 */

const api = vi.hoisted(() => ({ compareTakes: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => api }))
/** 描画は差し替え、渡された材料と理由だけを控える。 */
const shown = vi.hoisted((): { compare: unknown; error: string | null } => ({ compare: null, error: null }))
vi.mock('@/components/take-compare', () => ({
  TakeCompare: (props: { readonly compare: unknown; readonly error: string | null }) => {
    shown.compare = props.compare
    shown.error = props.error
    return null
  },
}))

const take = Take.parse({ ...takeJson, createdAt: new Date() })
const COMPARE = { a: { takeId: take.id }, b: null }

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-18T00:00:00Z'))
  api.compareTakes.mockReset()
  api.compareTakes.mockResolvedValue(COMPARE)
  shown.compare = null
  shown.error = null
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Take 比較の材料の取り直し', () => {
  it('期限の前（1 時間の 8 割）に取り直す', async () => {
    render(<TakeComparePanel shotId={ShotId.parse(SHOT_ID)} takes={[take]} selectedTakeId={take.id} />)
    await flush()
    expect(api.compareTakes).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_880_000)
    })
    expect(api.compareTakes).toHaveBeenCalledTimes(2)
  })

  it('取り直しに失敗しても映っている比較を残し、少し待ってもう一度取りにいく', async () => {
    render(<TakeComparePanel shotId={ShotId.parse(SHOT_ID)} takes={[take]} selectedTakeId={take.id} />)
    await flush()
    expect(shown.compare).toBe(COMPARE)

    api.compareTakes.mockRejectedValueOnce(new Error('通信が切れました'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_880_000)
    })
    await flush()
    expect(api.compareTakes).toHaveBeenCalledTimes(2)
    expect(shown.compare).toBe(COMPARE)
    expect(shown.error).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(api.compareTakes).toHaveBeenCalledTimes(3)
  })

  it('初めて取るときに失敗したら理由を出す（残す材料が無い）', async () => {
    api.compareTakes.mockRejectedValueOnce(new Error('HTTP 500'))
    render(<TakeComparePanel shotId={ShotId.parse(SHOT_ID)} takes={[take]} selectedTakeId={take.id} />)
    await flush()

    expect(shown.compare).toBeNull()
    expect(shown.error).toContain('HTTP 500')
  })
})
