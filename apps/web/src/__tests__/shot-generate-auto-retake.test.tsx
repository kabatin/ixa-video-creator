import { ShotId } from '@ixa/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ShotGenerateSection, type ShotGenerateApi } from '@/components/workbench/inspector/shot-generate-section'
import { ContextMenuHost } from '@/components/workbench/ui/context-menu'
import { WorkbenchContext } from '@/components/workbench/workbench-context'
import { WireGenerateResult } from '@/lib/api-schemas'
import type { ShotPosterMap } from '@/lib/shot-posters'
import { JOB_ID, SHOT_ID } from './fixtures'
import { aWorkbenchShot, workbenchValue } from './workbench-fixture'

/**
 * 1 本ずつの生成で「NG なら自動で作り直す」を選べる（ADR-0057）。**既定は選ばない**（作り直しを勧めるだけ）。
 */

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
  getCostMeter: vi.fn(() => Promise.reject(new Error('unused'))),
  requestReview: vi.fn(),
  listModels: vi.fn(() => Promise.resolve([])),
  cancelGenerations: vi.fn(),
})

const posters: ShotPosterMap = new Map([
  [ShotId.parse(SHOT_ID), { url: null, reason: 'まだ Take がありません', hasStartFrame: true, pending: false, drawing: false }],
])

const show = (api: ShotGenerateApi) => {
  const shot = aWorkbenchShot(1, { id: SHOT_ID, status: 'draft', description: '屋上で二人が出会う' })
  render(
    <WorkbenchContext.Provider value={workbenchValue({ shots: [shot], posters })}>
      <ContextMenuHost>
        <ShotGenerateSection shot={shot} api={api} />
      </ContextMenuHost>
    </WorkbenchContext.Provider>,
  )
}

describe('NG なら自動で作り直す', () => {
  it('既定では選ばず、送らない', async () => {
    const api = fakeApi()
    show(api)
    const box = await screen.findByRole('checkbox', { name: /NG なら自動で作り直す/ })
    expect(box).not.toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'Take を生成' }))
    expect(api.generateTakes).toHaveBeenCalledWith(SHOT_ID, expect.not.objectContaining({ autoRetake: true }))
  })

  it('選べば autoRetake: true で頼む', async () => {
    const api = fakeApi()
    show(api)
    await userEvent.click(await screen.findByRole('checkbox', { name: /NG なら自動で作り直す/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Take を生成' }))
    expect(api.generateTakes).toHaveBeenCalledWith(SHOT_ID, expect.objectContaining({ autoRetake: true }))
  })
})
