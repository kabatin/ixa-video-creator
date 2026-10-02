import { ShotId, type Shot } from '@ixa/domain'
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
import { WireGenerateResult } from '@/lib/api-schemas'
import type { WireCostMeter } from '@/lib/cost-meter-api'
import type { ShotPosterMap } from '@/lib/shot-posters'
import { JOB_ID, SHOT_ID } from './fixtures'
import { aWorkbenchShot, workbenchValue } from './workbench-fixture'

/**
 * 説明も絵も無い Shot で Take を作る前に確かめる（制作者 2026-10-01「全然関係ない動画が生成されてしまう」）。
 * 止めはしない（このまま作れる）。
 */

const meter: WireCostMeter = {
  budgetUsd: 300,
  measured: { takeCount: 0, totalUsd: 0, byProvider: [] },
  stub: { takeCount: 0, totalUsd: 0 },
  byShot: [],
  unlistedShots: { takeCount: 0, measuredUsd: 0, stubTakeCount: 0 },
  otherRuns: [],
  totalUsd: 0,
}

const fakeApi = (): ShotGenerateApi => ({
  generateTakes: vi.fn(() =>
    Promise.resolve(
      WireGenerateResult.parse({
        jobIds: [JOB_ID],
        specHash: 'a'.repeat(64),
        resolvedModel: 'kling-v2',
        duplicateOfTakeId: null,
        stretchedToFit: false,
      }),
    ),
  ),
  listTakes: vi.fn(() => Promise.resolve([])),
  getCostMeter: vi.fn(() => Promise.resolve(meter)),
  requestReview: vi.fn(),
  listModels: vi.fn(() => Promise.resolve([])),
  cancelGenerations: vi.fn(),
})

const postersWith = (hasStartFrame: boolean): ShotPosterMap =>
  new Map([[ShotId.parse(SHOT_ID), { url: null, reason: 'まだ Take がありません', hasStartFrame }]])

const Harness = ({
  api,
  description,
  hasStartFrame,
}: {
  readonly api: ShotGenerateApi
  readonly description: string
  readonly hasStartFrame: boolean
}) => {
  const [shot, setShot] = useState<Shot>(() =>
    aWorkbenchShot(1, { id: SHOT_ID, status: 'draft', description }),
  )
  const value = useMemo(
    () =>
      workbenchValue({
        shots: [shot],
        posters: postersWith(hasStartFrame),
        replaceShots: (updated) => {
          const next = updated[0]
          if (next !== undefined) setShot(next)
        },
      }),
    [shot, hasStartFrame],
  )
  return (
    <WorkbenchContext.Provider value={value}>
      <ContextMenuHost>
        <ShotGenerateSection shot={shot} api={api} />
      </ContextMenuHost>
    </WorkbenchContext.Provider>
  )
}

describe('説明も絵も無い Shot の Take', () => {
  it('作る前に確かめ、「このまま Take を作る」で作る', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<Harness api={api} description="" hasStartFrame={false} />)

    await user.click(await screen.findByRole('button', { name: 'Take を生成' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/作品と関係ない映像/)).toBeInTheDocument()
    expect(api.generateTakes).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'このまま Take を作る' }))
    expect(api.generateTakes).toHaveBeenCalledTimes(1)
  })

  it('「戻る」なら作らない', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<Harness api={api} description="" hasStartFrame={false} />)

    await user.click(await screen.findByRole('button', { name: 'Take を生成' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '戻る' }))

    expect(api.generateTakes).not.toHaveBeenCalled()
  })

  it('説明か最初のフレームがあれば、確かめずに作る', async () => {
    for (const props of [
      { description: '夕焼けの屋上で振り返る', hasStartFrame: false },
      { description: '', hasStartFrame: true },
    ]) {
      const user = userEvent.setup()
      const api = fakeApi()
      const { unmount } = render(<Harness api={api} {...props} />)

      await user.click(await screen.findByRole('button', { name: 'Take を生成' }))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(api.generateTakes).toHaveBeenCalledTimes(1)
      unmount()
    }
  })
})
