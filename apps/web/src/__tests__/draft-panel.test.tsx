import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DraftPanel } from '@/components/workbench/panels/draft-panel'
import { renderInWorkbench } from './workbench-fixture'

/**
 * 絵コンテの案のパネル（ワークベンチ）。Shot が無いうちは、案を作る相手がいないことと、次にやることを言う
 * （制作者 2026-10-04「絵コンテの案のところ、Shot作ったあとに表示しても空なので」）。
 */
describe('DraftPanel', () => {
  it('Shot が 0 件なら、区切って Shot にする道を出す', async () => {
    const { value } = renderInWorkbench(<DraftPanel />, { shots: [] })

    expect(screen.getByText('Shot はまだありません')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '区切って Shot にする' }))
    expect(value.openCutter).toHaveBeenCalledWith('cut')
  })
})
