import { ShotId, newId } from '@ixa/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ImageActivityStrip } from '@/components/workbench/image-activity-strip'
import { countDrawing, type ShotPosterMap, type ShotPosterView } from '@/lib/shot-posters'

/**
 * 絵を作っている数と、まとめて止める口（制作者 2026-10-04「いま30個ぐらいキューに入ってる画像生成とめたい」）。
 * 一括で絵を作ると Codex が 1 枚ずつ作るので、順番待ちが長く残る。止める口が無かった。
 */

const poster = (drawing: boolean): ShotPosterView => ({
  url: null,
  reason: 'まだ Take がありません',
  pending: false,
  hasStartFrame: false,
  drawing,
})

describe('countDrawing', () => {
  it('絵を作っている Shot を数える', () => {
    const posters: ShotPosterMap = new Map([
      [newId(ShotId), poster(true)],
      [newId(ShotId), poster(false)],
      [newId(ShotId), poster(true)],
    ])
    expect(countDrawing(posters)).toBe(2)
  })
})

describe('ImageActivityStrip', () => {
  it('作っていなければ何も出さない', () => {
    const { container } = render(<ImageActivityStrip drawingCount={0} onStopAll={vi.fn()} />)
    expect(container.textContent).toBe('')
  })

  it('作っている数を出し、「すべてやめる」で止める', async () => {
    const onStopAll = vi.fn(() => Promise.resolve())
    render(<ImageActivityStrip drawingCount={31} onStopAll={onStopAll} />)

    expect(screen.getByRole('status')).toHaveTextContent('絵を作っています（31 件）')
    await userEvent.click(screen.getByRole('button', { name: 'すべてやめる' }))
    expect(onStopAll).toHaveBeenCalledTimes(1)
  })
})
