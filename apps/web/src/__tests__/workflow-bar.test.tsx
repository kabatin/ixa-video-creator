import { ShotId, type MusicTrack } from '@ixa/domain'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { WorkflowBar } from '@/components/workbench/workflow-bar'
import type { ShotPosterMap } from '@/lib/shot-posters'
import { aWorkbenchShot, renderInWorkbench } from './workbench-fixture'

/**
 * 制作の流れの帯（制作者 2026-10-01「上部に流れの帯」）。済んだ所に ✓、途中は件数、次にやる所を目立たせ、
 * 押すとその作業の画面へ。
 */

const track = { id: 'track-1', title: 'iXA CUP' } as unknown as MusicTrack

const postersFor = (ids: readonly string[], withFrame: readonly boolean[]): ShotPosterMap =>
  new Map(
    ids.map((id, index) => [
      ShotId.parse(id),
      { url: null, reason: 'まだ Take がありません', hasStartFrame: withFrame[index] ?? false, pending: false },
    ]),
  )

describe('WorkflowBar', () => {
  it('楽曲が無ければ ① 音楽が次。押すと楽曲の登録のしかたを言う', async () => {
    const { value } = renderInWorkbench(<WorkflowBar />, { track: null, shots: [] })

    const music = screen.getByRole('button', { name: /① 音楽/ })
    expect(music).toHaveAttribute('aria-current', 'step')

    await userEvent.click(music)
    expect(value.focusPanel).toHaveBeenCalledWith('assets')
    expect(value.notify).toHaveBeenCalledWith(expect.stringContaining('楽曲がまだありません'))
  })

  it('方針が空なら ② が次。押すと作品の方針を開く', async () => {
    const { value } = renderInWorkbench(<WorkflowBar />, { track, concept: '', shots: [] })

    const concept = screen.getByRole('button', { name: /② 作品の方針・歌詞/ })
    expect(concept).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: /① 音楽/ })).toHaveTextContent('✓')

    await userEvent.click(concept)
    expect(value.inspect).toHaveBeenCalledWith({ kind: 'project', id: value.projectId })
    expect(value.focusPanel).toHaveBeenCalledWith('inspector')
  })

  it('絵コンテ・絵・Take は件数を出し、押すとその作業の画面へ', async () => {
    const shots = [
      aWorkbenchShot(1, { description: '屋上', selectedTakeId: null }),
      aWorkbenchShot(2, { description: '', selectedTakeId: null }),
    ]
    const { value } = renderInWorkbench(<WorkflowBar />, {
      track,
      concept: '夜明け',
      shots,
      posters: postersFor(
        shots.map((shot) => shot.id),
        [true, false],
      ),
    })

    expect(screen.getByRole('button', { name: /⑤ 絵コンテ/ })).toHaveTextContent('1/2')
    expect(screen.getByRole('button', { name: /⑥ 絵/ })).toHaveTextContent('1/2')
    expect(screen.getByRole('button', { name: /⑦ Take/ })).toHaveTextContent('0/2')
    expect(screen.getByRole('button', { name: /⑤ 絵コンテ/ })).toHaveAttribute('aria-current', 'step')

    await userEvent.click(screen.getByRole('button', { name: /⑤ 絵コンテ/ }))
    expect(value.focusPanel).toHaveBeenCalledWith('draft')
    await userEvent.click(screen.getByRole('button', { name: /③ 区切る/ }))
    expect(value.focusPanel).toHaveBeenCalledWith('cutter')
    await userEvent.click(screen.getByRole('button', { name: /⑦ Take/ }))
    expect(value.focusPanel).toHaveBeenCalledWith('shots')
  })
})
