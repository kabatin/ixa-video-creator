import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TransportButtons } from '@/components/workbench/transport-buttons'
import type { WorkbenchTransport } from '@/components/workbench/workbench-context'
import { aWorkbenchShot, renderInWorkbench, workbenchValue } from './workbench-fixture'

/**
 * 再生の操作列（2026-09-28、制作者の提案「一般的な動画編集ツールにあるボタン類を並べる」）。
 * 前の境目へ・1 コマ戻る・再生 / 一時停止・1 コマ進む・次の境目へ。
 * プレビューの下と「聴きながら切る」の両方に置き、位置は共有の 1 つを動かす。
 */

const at = (currentSec: number, playing = false): WorkbenchTransport => ({
  currentSec,
  playing,
  seek: null,
  owner: playing ? 'monitor' : null,
})

const renderButtons = (transport: WorkbenchTransport) => {
  const base = workbenchValue()
  const transportControls = { ...base.transportControls, getTransport: vi.fn(() => transport) }
  const { value } = renderInWorkbench(
    <TransportButtons owner="cutter" durationSec={20} />,
    // Shot は 4〜8 秒と 8〜12 秒（fixture は index × 4 秒から 4 秒）。
    { shots: [aWorkbenchShot(1), aWorkbenchShot(2)], transportControls },
    {},
    transport,
  )
  return value
}

describe('TransportButtons', () => {
  it('5 つを一般的な順に並べる', () => {
    renderButtons(at(0))
    const names = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))
    expect(names).toEqual(['前の境目へ', '1コマ戻る', '再生', '1コマ進む', '次の境目へ'])
  })

  it('1 コマ進むと、止めてから 1/fps 秒先へ飛ぶ', async () => {
    const value = renderButtons(at(1, true))

    await userEvent.click(screen.getByRole('button', { name: '1コマ進む' }))

    expect(value.transportControls.pause).toHaveBeenCalled()
    expect(vi.mocked(value.transportControls.seekTo).mock.calls.at(-1)?.[0]).toBeCloseTo(31 / 30)
  })

  it('1 コマ戻る', async () => {
    const value = renderButtons(at(1))

    await userEvent.click(screen.getByRole('button', { name: '1コマ戻る' }))

    expect(vi.mocked(value.transportControls.seekTo).mock.calls.at(-1)?.[0]).toBeCloseTo(29 / 30)
  })

  it('止まっているとき、次の境目へ・前の境目へは Shot の境目へ飛ぶ', async () => {
    const value = renderButtons(at(5))

    await userEvent.click(screen.getByRole('button', { name: '次の境目へ' }))
    await userEvent.click(screen.getByRole('button', { name: '前の境目へ' }))

    expect(value.transportControls.seekTo).toHaveBeenNthCalledWith(1, 8)
    expect(value.transportControls.seekTo).toHaveBeenNthCalledWith(2, 4)
  })

  /** 再生中はいまの Shot の頭を飛ばす。再生は止めない。 */
  it('再生中の前の境目へは、1 つ前の Shot の頭へ（再生は止めない）', async () => {
    const value = renderButtons(at(10, true))

    await userEvent.click(screen.getByRole('button', { name: '前の境目へ' }))

    expect(value.transportControls.seekTo).toHaveBeenCalledWith(4)
    expect(value.transportControls.pause).not.toHaveBeenCalled()
  })

  it('最後の境目より後ろでは、次の境目へは何もしない', async () => {
    const value = renderButtons(at(20))

    await userEvent.click(screen.getByRole('button', { name: '次の境目へ' }))

    expect(value.transportControls.seekTo).not.toHaveBeenCalled()
  })
})
