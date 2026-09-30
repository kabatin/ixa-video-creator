import { TimelineClip, TimelineClipId } from '@ixa/domain'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useTextClipMenu } from '@/components/workbench/use-text-clip-menu'
import { aProject, renderInWorkbench } from './workbench-fixture'

/** テロップの右クリックのメニュー。右クリックしたテロップを選び、そのテロップに対して動く。 */

const fake = vi.hoisted(() => ({ deleteClip: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => fake }))

const CLIP_ID = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB0')
const clip = TimelineClip.parse({
  id: CLIP_ID,
  projectId: aProject.id,
  track: 'TEXT',
  startSec: 1,
  durationSec: 2,
  layer: 0,
  content: { type: 'text', templateKey: 'plain', params: { text: '一行目' } },
  opacity: 1,
  createdAt: new Date(),
})

const Opener = () => {
  const menu = useTextClipMenu()
  return (
    <button
      type="button"
      onClick={(event) => {
        menu.open(clip, { x: 1, y: 1 }, event.currentTarget)
      }}
    >
      開く
    </button>
  )
}

const setup = async () => {
  const rendered = renderInWorkbench(<Opener />)
  await userEvent.click(screen.getByRole('button', { name: '開く' }))
  return rendered
}

describe('useTextClipMenu', () => {
  it('開くとそのテロップを選び、インスペクターで直す で前に出す', async () => {
    const { value } = await setup()

    expect(value.inspect).toHaveBeenCalledWith({ kind: 'text-clip', id: CLIP_ID })
    await userEvent.click(screen.getByRole('menuitem', { name: 'インスペクターで直す' }))
    expect(value.focusPanel).toHaveBeenCalledWith('inspector')
  })

  it('削除は確認のあとで消し、読み直す', async () => {
    const { value } = await setup()

    await userEvent.click(screen.getByRole('menuitem', { name: 'テロップを削除' }))
    expect(fake.deleteClip).not.toHaveBeenCalled()
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'テロップを削除' }),
    )

    await waitFor(() => {
      expect(fake.deleteClip).toHaveBeenCalledWith(CLIP_ID)
      expect(value.refresh).toHaveBeenCalled()
    })
  })
})
