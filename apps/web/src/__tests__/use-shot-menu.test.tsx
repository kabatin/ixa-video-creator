import type { Shot } from '@ixa/domain'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useShotMenu } from '@/components/workbench/use-shot-menu'
import { aWorkbenchShot, renderInWorkbench } from './workbench-fixture'

/**
 * Shot の右クリックのメニュー（タイムライン・ストーリーボード・Shot 一覧で共通）。
 * **右クリックした Shot を選び、その Shot に対して動く。** 操作は既存のもの（新しい操作を作らない）。
 */

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => ({
    generateStartFrame: vi.fn(() => Promise.resolve({ jobId: 'job-1' })),
    unselectTake: vi.fn(),
  }),
}))

const Opener = ({
  shot,
  list,
}: {
  readonly shot: Shot
  readonly list?: { checked: boolean; toggle: () => void }
}) => {
  const openShotMenu = useShotMenu()
  return (
    <button
      type="button"
      onClick={(event) => {
        openShotMenu(shot, { x: 1, y: 1 }, event.currentTarget, list)
      }}
    >
      {shot.code}
    </button>
  )
}

const open = async (
  shot: Shot = aWorkbenchShot(1),
  list?: { checked: boolean; toggle: () => void },
) => {
  const rendered = renderInWorkbench(
    <Opener shot={shot} {...(list === undefined ? {} : { list })} />,
    { shots: [shot] },
  )
  await userEvent.click(screen.getByRole('button', { name: shot.code }))
  return rendered
}

describe('useShotMenu', () => {
  it('開くと、右クリックした Shot を選ぶ', async () => {
    const shot = aWorkbenchShot(1)
    const { value } = await open(shot)

    expect(value.selectShot).toHaveBeenCalledWith(shot.id)
    expect(screen.getByRole('menu', { name: `Shot ${shot.code} の操作` })).toBeInTheDocument()
  })

  it('Take を作る… で、その Shot の作る欄を開く', async () => {
    const { value } = await open()

    await userEvent.click(screen.getByRole('menuitem', { name: /Take を作る/ }))

    expect(value.openInspector).toHaveBeenCalledWith('generate')
  })

  it('Take 比較で見る で、Take 比較を前に出す', async () => {
    const { value } = await open()

    await userEvent.click(screen.getByRole('menuitem', { name: /Take 比較で見る/ }))

    expect(value.focusPanel).toHaveBeenCalledWith('compare')
  })

  it('削除… は、右クリックした Shot だけを対象にして確認のダイアログを開く', async () => {
    const shot = aWorkbenchShot(2)
    const { value } = await open(shot)

    await userEvent.click(screen.getByRole('menuitem', { name: /削除/ }))

    expect(value.openDialog).toHaveBeenCalledWith('delete-shots', { shotIds: [shot.id] })
  })

  it('Shot 一覧では、チェックの付け外しを呼ぶ', async () => {
    const toggle = vi.fn()
    await open(aWorkbenchShot(1), { checked: false, toggle })

    await userEvent.click(screen.getByRole('menuitem', { name: 'チェックを付ける' }))

    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('絵コンテの画像を AI で作る で、絵を作り始めたと知らせる', async () => {
    const shot = aWorkbenchShot(1)
    const { value } = await open(shot)

    await userEvent.click(screen.getByRole('menuitem', { name: /絵コンテの画像を AI で作る/ }))

    await vi.waitFor(() => {
      expect(value.notify).toHaveBeenCalledWith(
        expect.stringContaining(`${shot.code} の絵コンテの画像を作り始めました`),
      )
    })
  })
})
