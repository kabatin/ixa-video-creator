import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MakeSfxDialogBody } from '@/components/workbench/dialogs/make-sfx-dialog'
import { cueRowFromCue } from '@/lib/sfx-cue-rows'
import { aWorkbenchShot, renderInWorkbench } from './workbench-fixture'

const useShotMotion = vi.hoisted(() => vi.fn<(shotId: string | null) => { state: 'loading' }>(() => ({ state: 'loading' })))
vi.mock('@/components/workbench/use-shot-motion', () => ({ useShotMotion }))

/**
 * 前に作った効果音を元に作る（プロンプトビューアの「これを元に作る」）。Shot を選んでいても、その Shot の動きを
 * 分析しない（分析は AI で絵を見るので費用が掛かることがある）。Shot の案内も出さない。
 */
describe('効果音を作る窓（前の音を元に作る）', () => {
  it('選んでいる Shot があっても動きを読まず、Shot の文と読み込み中を出さない', () => {
    const shot = aWorkbenchShot(1)
    const rows = [cueRowFromCue({ startSec: 2, durationSec: 1.5, prompt: 'metal clang', volume: 0.8 })]
    renderInWorkbench(<MakeSfxDialogBody initialRows={rows} />, { shots: [shot], selectedShotId: shot.id })

    expect(useShotMotion.mock.calls.every(([shotId]) => shotId === null)).toBe(true)
    expect(screen.getByDisplayValue('metal clang')).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(`${shot.code} の採用中の Take`))).toBeNull()
    expect(screen.queryByText('読み込んでいます…')).toBeNull()
  })

  it('元にする行が無ければ、いつもどおり選んでいる Shot の動きを読む', () => {
    useShotMotion.mockClear()
    const shot = aWorkbenchShot(1)
    renderInWorkbench(<MakeSfxDialogBody />, { shots: [shot], selectedShotId: shot.id })
    expect(useShotMotion).toHaveBeenCalledWith(shot.id)
  })
})
