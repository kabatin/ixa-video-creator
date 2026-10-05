import type { AiSettings } from '@ixa/domain'
import { waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AiSetupOffer } from '@/components/workbench/ai-setup-offer'
import type { AiSettingsApi } from '@/lib/ai-settings-api'
import { renderInWorkbench } from './workbench-fixture'

/**
 * 初めてワークベンチを開いたときに「使う AI」を 1 度だけ勧める（ADR-0032）。
 * 選ばずに閉じても次からは出さない（メニューから開ける）。
 */

const SETTINGS: AiSettings = { text: 'stub', image: 'stub', video: 'stub', voice: 'stub', transcribe: 'stub' }

const apiWith = (source: 'saved' | 'default'): Pick<AiSettingsApi, 'getAiSettings'> => ({
  getAiSettings: vi.fn(() => Promise.resolve({ settings: SETTINGS, source })),
})

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    values,
  }
}

describe('AiSetupOffer', () => {
  it('まだ選んでいなければ「使う AI」を開き、勧めたことを覚える', async () => {
    const storage = memoryStorage()
    const { value } = renderInWorkbench(<AiSetupOffer api={apiWith('default')} storage={storage} />)

    await waitFor(() => {
      expect(value.openDialog).toHaveBeenCalledWith('ai-setup')
    })
    expect(storage.values.size).toBe(1)
  })

  it('選んであれば開かない', async () => {
    const api = apiWith('saved')
    const { value } = renderInWorkbench(<AiSetupOffer api={api} storage={memoryStorage()} />)

    await waitFor(() => {
      expect(api.getAiSettings).toHaveBeenCalled()
    })
    expect(value.openDialog).not.toHaveBeenCalled()
  })

  it('一度勧めていれば、選ばずに閉じていても開かない', async () => {
    const storage = memoryStorage()
    renderInWorkbench(<AiSetupOffer api={apiWith('default')} storage={storage} />)
    await waitFor(() => {
      expect(storage.values.size).toBe(1)
    })

    const api = apiWith('default')
    const { value } = renderInWorkbench(<AiSetupOffer api={api} storage={storage} />)
    await waitFor(() => {
      expect(api.getAiSettings).toHaveBeenCalled()
    })
    expect(value.openDialog).not.toHaveBeenCalled()
  })

  /** 読めなくても作業の邪魔をしない（ダイアログを出さないだけ）。 */
  it('設定を読めなければ何もしない', async () => {
    const api = { getAiSettings: vi.fn(() => Promise.reject(new Error('繋がりません'))) }
    const { value } = renderInWorkbench(<AiSetupOffer api={api} storage={memoryStorage()} />)

    await waitFor(() => {
      expect(api.getAiSettings).toHaveBeenCalled()
    })
    expect(value.openDialog).not.toHaveBeenCalled()
  })
})
