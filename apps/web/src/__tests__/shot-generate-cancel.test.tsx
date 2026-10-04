import type { Shot } from '@ixa/domain'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMemo, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  ShotGenerateSection,
  type ShotGenerateApi,
} from '@/components/workbench/inspector/shot-generate-section'
import { ContextMenuHost } from '@/components/workbench/ui/context-menu'
import { WorkbenchContext } from '@/components/workbench/workbench-context'
import type { WireCostMeter } from '@/lib/cost-meter-api'
import { SHOT_ID } from './fixtures'
import { aWorkbenchShot, workbenchValue } from './workbench-fixture'

/**
 * 生成中の行から生成をやめる（制作者 2026-10-01「動画生成をキャンセル出来るようにしたい、もし出来るならUIが分かりづらい」）。
 * 確認は右クリックのメニューと同じ殻。「しない」側は「続ける」（「やめる」だと逆の意味に読める）。
 */

const meter: WireCostMeter = {
  budgetUsd: 300,
  measured: { takeCount: 0, totalUsd: 0, byProvider: [] },
  stub: { takeCount: 0, totalUsd: 0 },
  byShot: [],
  unlistedShots: { takeCount: 0, measuredUsd: 0, stubTakeCount: 0 },
  otherRuns: [],
  copied: { takeCount: 0, totalUsd: 0 },
  totalUsd: 0,
}

const fakeApi = (cancelled: (shot: Shot) => Shot): ShotGenerateApi => ({
  generateTakes: vi.fn(),
  listTakes: vi.fn(() => Promise.resolve([])),
  getCostMeter: vi.fn(() => Promise.resolve(meter)),
  requestReview: vi.fn(),
  listModels: vi.fn(() => Promise.resolve([])),
  cancelGenerations: vi.fn((shotId) =>
    Promise.resolve({
      cancelledJobIds: ['01ARZ3NDEKTSV4RRFFQ69G5FJ0'],
      shot: cancelled(aWorkbenchShot(1, { id: shotId, status: 'generating' })),
    }),
  ),
})

const Harness = ({ api }: { readonly api: ShotGenerateApi }) => {
  const [shot, setShot] = useState<Shot>(() =>
    aWorkbenchShot(1, { id: SHOT_ID, status: 'generating' }),
  )
  const value = useMemo(
    () =>
      workbenchValue({
        shots: [shot],
        replaceShots: (updated) => {
          const next = updated[0]
          if (next !== undefined) setShot(next)
        },
      }),
    [shot],
  )
  return (
    <WorkbenchContext.Provider value={value}>
      <ContextMenuHost>
        <ShotGenerateSection shot={shot} api={api} />
      </ContextMenuHost>
    </WorkbenchContext.Provider>
  )
}

describe('生成中の行の「生成をやめる」', () => {
  it('確認してから止め、Shot をサーバの決め直しで置き換える', async () => {
    const user = userEvent.setup()
    const api = fakeApi((shot) => ({ ...shot, status: 'draft' }))
    render(<Harness api={api} />)

    await user.click(screen.getByRole('button', { name: '生成をやめる' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/費用/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '生成をやめる' }))

    expect(api.cancelGenerations).toHaveBeenCalledWith(SHOT_ID)
    expect(await screen.findByRole('button', { name: 'Take を生成' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '生成をやめる' })).toBeNull()
  })

  it('「続ける」なら止めない', async () => {
    const user = userEvent.setup()
    const api = fakeApi((shot) => ({ ...shot, status: 'draft' }))
    render(<Harness api={api} />)

    await user.click(screen.getByRole('button', { name: '生成をやめる' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '続ける' }))

    expect(api.cancelGenerations).not.toHaveBeenCalled()
  })
})
