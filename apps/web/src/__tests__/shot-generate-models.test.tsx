import type { Shot, TakeId } from '@ixa/domain'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ShotGenerateSection,
  type ShotGenerateApi,
} from '@/components/workbench/inspector/shot-generate-section'
import { WorkbenchContext } from '@/components/workbench/workbench-context'
import type { WireVideoModel } from '@/lib/models-api'
import { SHOT_ID } from './fixtures'
import { aWorkbenchShot, workbenchValue } from './workbench-fixture'

/**
 * 生成のモデル選択（ADR-0025）。登録されているモデルを選べ、最初のフレームが要るモデルで
 * 画像が無ければ、押す前に理由を出す（押しても API が断るだけになる）。
 */

const local = {
  id: 'local/still-motion',
  providerId: 'local',
  label: '画像から動画（ローカル・無料）',
  requiresStartFrame: true,
  routable: false,
  costPerSecondUsd: 0,
} as WireVideoModel

const api = (): ShotGenerateApi => ({
  generateTakes: vi.fn(),
  listTakes: vi.fn(() => Promise.resolve([])),
  getCostMeter: vi.fn(() => Promise.reject(new Error('unused'))),
  requestReview: vi.fn((takeId: TakeId) => Promise.resolve({ takeId, queued: true })),
  listModels: vi.fn(() => Promise.resolve([local])),
  cancelGenerations: vi.fn(),
})

const renderSection = (hasStartFrame: boolean) => {
  const shot: Shot = aWorkbenchShot(1, { id: SHOT_ID })
  return render(
    <WorkbenchContext.Provider value={workbenchValue({ shots: [shot] })}>
      <ShotGenerateSection shot={shot} api={api()} hasStartFrame={hasStartFrame} />
    </WorkbenchContext.Provider>,
  )
}

describe('生成のモデル選択', () => {
  it('登録されているモデルを選べる', async () => {
    renderSection(false)

    expect(await screen.findByRole('option', { name: '画像から動画（ローカル・無料）' })).toBeTruthy()
  })

  it('最初のフレームが要るモデルで画像が無ければ、押せず理由を出す', async () => {
    renderSection(false)
    await screen.findByRole('option', { name: '画像から動画（ローカル・無料）' })

    await userEvent.selectOptions(screen.getByLabelText('モデル'), 'local/still-motion')

    expect(screen.getByRole('button', { name: 'Take を生成' })).toBeDisabled()
    expect(screen.getByText(/最初のフレーム/)).toBeTruthy()
  })

  it('画像があれば押せる', async () => {
    renderSection(true)
    await screen.findByRole('option', { name: '画像から動画（ローカル・無料）' })

    await userEvent.selectOptions(screen.getByLabelText('モデル'), 'local/still-motion')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Take を生成' })).toBeEnabled()
    })
  })
})
