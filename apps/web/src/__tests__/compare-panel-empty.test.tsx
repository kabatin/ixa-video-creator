import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ComparePanel } from '@/components/workbench/panels/compare-panel'
import type { ActiveGenerations } from '@/components/workbench/use-active-generations'
import type { ShotPosterMap } from '@/lib/shot-posters'
import { aWorkbenchShot, renderInWorkbench } from './workbench-fixture'

/**
 * Take がまだ無い Shot の Take 比較（制作者 2026-10-02「作り方の案内やインスペクターを開くボタンなどがないので迷う」）。
 * 「生成を実行してください」とだけ出て、どこで作るのか分からなかった。
 */

/** 「本番で作り直す」が段を探すために一覧を読む（ADR-0042）。読めなくても比較は使える。 */
const api = vi.hoisted(() => ({ listTakes: vi.fn(), listModels: vi.fn(() => Promise.resolve([])) }))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => api }))

const described = aWorkbenchShot(1, { description: '夜の街を走る' })
const blank = aWorkbenchShot(1, { description: '' })

const postersWith = (shot: typeof blank, hasStartFrame: boolean): ShotPosterMap =>
  new Map([[shot.id, { url: null, reason: 'まだ Take がありません', hasStartFrame, pending: false, drawing: false }]])

const generatingFor = (shot: typeof blank): ActiveGenerations =>
  new Map([
    [
      shot.id,
      [
        {
          jobId: 'job-1',
          shotId: shot.id,
          status: 'running' as const,
          modelId: 'stub',
          modelLabel: 'お試し',
          estimatedLatencySec: null,
          queuedAt: '2026-10-02T00:00:00.000Z',
          startedAt: '2026-10-02T00:00:01.000Z',
          providerStartedAt: '2026-10-02T00:00:01.000Z',
          attempt: 1,
        },
      ],
    ],
  ])

beforeEach(() => {
  api.listTakes.mockReset()
  api.listTakes.mockResolvedValue([])
})

describe('Take がまだ無い Shot の Take 比較', () => {
  it('作り方の順番を出し、「インスペクターを表示」で その Shot の作る欄を開く', async () => {
    const { value } = renderInWorkbench(<ComparePanel />, {
      shots: [described],
      selectedShotId: described.id,
      posters: postersWith(described, false),
    })

    expect(await screen.findByText('CUT-01 の Take はまだありません')).toBeInTheDocument()
    expect(screen.queryByText(/生成を実行してください/)).not.toBeInTheDocument()
    const steps = screen.getByRole('list', { name: 'Take の作り方' })
    expect(steps).toHaveTextContent('説明か最初のフレーム')
    expect(steps).toHaveTextContent('モデルを選んで作る')
    expect(steps).toHaveTextContent('見比べて採用')

    await userEvent.click(screen.getByRole('button', { name: 'インスペクターを表示' }))
    expect(value.selectShot).toHaveBeenCalledWith(described.id)
    expect(value.openInspector).toHaveBeenCalledWith('generate')
  })

  it('説明も最初のフレームも無ければ、先に絵コンテを入れる口を出す', async () => {
    const { value } = renderInWorkbench(<ComparePanel />, {
      shots: [blank],
      selectedShotId: blank.id,
      posters: postersWith(blank, false),
    })

    expect(await screen.findByText(/説明も最初のフレームもありません/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '説明を書く' }))
    expect(value.selectShot).toHaveBeenCalledWith(blank.id)
    expect(value.openInspector).toHaveBeenCalledWith('settings')

    await userEvent.click(screen.getByRole('button', { name: '絵コンテの案を開く' }))
    expect(value.focusPanel).toHaveBeenCalledWith('draft')
  })

  it('最初のフレームがあれば、説明が空でも先に絵コンテとは言わない', async () => {
    renderInWorkbench(<ComparePanel />, {
      shots: [blank],
      selectedShotId: blank.id,
      posters: postersWith(blank, true),
    })

    expect(await screen.findByText('CUT-01 の Take はまだありません')).toBeInTheDocument()
    expect(screen.queryByText(/説明も最初のフレームもありません/)).not.toBeInTheDocument()
  })

  it('作っている最中なら「作っています」と言い、進み具合の欄を開く', async () => {
    const { value } = renderInWorkbench(<ComparePanel />, {
      shots: [described],
      selectedShotId: described.id,
      posters: postersWith(described, false),
      activeGenerations: generatingFor(described),
    })

    expect(await screen.findByText('Take を作っています')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'インスペクターを表示' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '進み具合を見る' }))
    expect(value.openInspector).toHaveBeenCalledWith('generate')
  })
})
