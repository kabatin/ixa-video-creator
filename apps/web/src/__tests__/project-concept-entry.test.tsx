import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AssetTree } from '@/components/workbench/asset-tree'
import { InspectorPanel } from '@/components/workbench/panels/inspector-panel'
import { isAssetSelection } from '@/lib/workbench-selection'
import { aProject, renderInWorkbench } from './workbench-fixture'

/**
 * 作品の方針（ADR-0030）への入口。素材ツリーの一番上から開き、右のインスペクターに出す。
 * 中身は `project-concept-inspector.test.tsx` が見る。ここは「たどり着けるか」だけ。
 */

vi.mock('@/components/workbench/inspector/project-concept-inspector', () => ({
  ProjectConceptInspector: () => <h2>作品の方針の中身</h2>,
}))

const PROJECT = { kind: 'project', id: aProject.id } as const

describe('作品の方針への入口', () => {
  /**
   * 作品の方針はインスペクターにしか出ない。インスペクターが Shot 一覧の裏に隠れていると、
   * 押しても行が光るだけで何も起きないように見えた（実機 2026-09-30）。1 回押すだけで前に出す。
   */
  it('素材ツリーの一番上にあり、1 回押すと作品の方針を選んでインスペクターを前に出す', async () => {
    const { value } = renderInWorkbench(<AssetTree />)

    const rows = screen.getAllByRole('button').filter((button) => button.closest('nav') !== null)
    expect(rows[0]).toHaveTextContent('作品の方針')

    await userEvent.click(screen.getByRole('button', { name: /作品の方針/ }))
    expect(value.inspect).toHaveBeenCalledWith(PROJECT)
    expect(value.focusPanel).toHaveBeenCalledWith('inspector')
  })

  it('Enter で開くと、インスペクターを前に出す（素材ビューアには出さない）', async () => {
    const { value } = renderInWorkbench(<AssetTree />)

    screen.getByRole('button', { name: /作品の方針/ }).focus()
    await userEvent.keyboard('{Enter}')

    expect(value.focusPanel).toHaveBeenCalledWith('inspector')
    expect(value.openViewer).not.toHaveBeenCalled()
  })

  it('選んでいるとインスペクターに作品の方針が出る', () => {
    renderInWorkbench(<InspectorPanel />, { inspected: PROJECT })

    expect(screen.getByRole('heading', { name: '作品の方針の中身' })).toBeInTheDocument()
  })

  it('作品の方針は素材ではない（素材ビューアに出さない）', () => {
    expect(isAssetSelection(PROJECT)).toBe(false)
  })
})
