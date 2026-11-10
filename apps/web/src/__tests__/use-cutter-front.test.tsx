import { MusicTrack } from '@ixa/domain'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCutterFront } from '@/components/workbench/use-cutter-front'
import { WorkbenchContext, type WorkbenchContextValue } from '@/components/workbench/workbench-context'
import { PROJECT_ID } from './fixtures'
import { aProject, aWorkbenchShot, workbenchValue } from './workbench-fixture'

/**
 * 聴きながら切るを前に出す配線（判定そのものは `shouldFrontCutter` のテスト）。
 * ドックを置き終えるのを待つこと・URL で指定されたら開いた時点では出さないこと・
 * Shot の数が変わっただけでは出さないことを固定する。
 */

const track = (id: string) =>
  MusicTrack.parse({
    id,
    projectId: PROJECT_ID,
    mediaAssetId: '01ARZ3NDEKTSV4RRFFQ69G5FD0',
    title: '曲',
    isMaster: true,
  })
const T1 = track('01ARZ3NDEKTSV4RRFFQ69G5FD1')
const T2 = track('01ARZ3NDEKTSV4RRFFQ69G5FD2')

type ProbeProps = { readonly ready: boolean; readonly skipInitial: boolean; readonly layoutRestored?: boolean }

const Probe = ({ ready, skipInitial, layoutRestored = false }: ProbeProps) => {
  useCutterFront(ready, skipInitial, layoutRestored)
  return null
}

const setup = (initial: Partial<WorkbenchContextValue>, props: ProbeProps) => {
  const focusPanel = vi.fn()
  const tree = (patch: Partial<WorkbenchContextValue>, next: ProbeProps) => (
    <WorkbenchContext.Provider value={workbenchValue({ focusPanel, ...patch })}>
      <Probe {...next} />
    </WorkbenchContext.Provider>
  )
  const view = render(tree(initial, props))
  return {
    focusPanel,
    rerender: (patch: Partial<WorkbenchContextValue>, next = props) => {
      view.rerender(tree(patch, next))
    },
  }
}

describe('useCutterFront', () => {
  it('ドックを置き終えるまで待ち、置けたら開いた時点の判定をする（楽曲あり・Shot 0 件）', () => {
    const { focusPanel, rerender } = setup({ track: T1, shots: [] }, { ready: false, skipInitial: false })
    expect(focusPanel).not.toHaveBeenCalled()
    rerender({ track: T1, shots: [] }, { ready: true, skipInitial: false })
    expect(focusPanel).toHaveBeenCalledTimes(1)
    expect(focusPanel).toHaveBeenCalledWith('cutter')
  })

  it('URL で下のタブを指定されたら、開いた時点では出さない。あとで楽曲が決まれば出す', () => {
    const { focusPanel, rerender } = setup({ track: T1, shots: [] }, { ready: true, skipInitial: true })
    expect(focusPanel).not.toHaveBeenCalled()
    rerender({ track: T2, shots: [] })
    expect(focusPanel).toHaveBeenCalledWith('cutter')
  })

  it('Shot の数が変わっただけでは出さない', () => {
    const { focusPanel, rerender } = setup({ track: T1, shots: [aWorkbenchShot(0)] }, { ready: true, skipInitial: false })
    rerender({ track: T1, shots: [] })
    rerender({ track: T1, shots: [aWorkbenchShot(0), aWorkbenchShot(1)] })
    expect(focusPanel).not.toHaveBeenCalled()
  })

  it('開いたあとでマスターの楽曲が決まったら出す', () => {
    const { focusPanel, rerender } = setup({ track: null, shots: [aWorkbenchShot(0)] }, { ready: true, skipInitial: false })
    expect(focusPanel).not.toHaveBeenCalled()
    rerender({ track: T1, shots: [aWorkbenchShot(0)] })
    expect(focusPanel).toHaveBeenCalledTimes(1)
  })
})

/** ナレーションから始める種類は、既定の配置で開いたらナレーションを前に出す（聴きながら切るの代わり）。 */
describe('useCutterFront のナレーションから始める種類', () => {
  const kamishibai = { ...aProject, kind: 'kamishibai' as const }

  it('既定の配置で開いたら、楽曲が無くてもナレーションを前に出す', () => {
    const { focusPanel } = setup({ project: kamishibai, track: null, shots: [] }, { ready: true, skipInitial: false })
    expect(focusPanel).toHaveBeenCalledTimes(1)
    expect(focusPanel).toHaveBeenCalledWith('narration')
  })

  it('楽曲があって Shot が 0 件でも、聴きながら切るではなくナレーション', () => {
    const { focusPanel } = setup({ project: kamishibai, track: T1, shots: [] }, { ready: true, skipInitial: false })
    expect(focusPanel.mock.calls).toEqual([['narration']])
  })

  it('保存した配置を戻したなら、ナレーションは前に出さない', () => {
    const { focusPanel } = setup(
      { project: kamishibai, track: null, shots: [] },
      { ready: true, skipInitial: false, layoutRestored: true },
    )
    expect(focusPanel).not.toHaveBeenCalled()
  })

  it('URL で下のタブを指定されたら出さない', () => {
    const { focusPanel } = setup({ project: kamishibai, track: null, shots: [] }, { ready: true, skipInitial: true })
    expect(focusPanel).not.toHaveBeenCalled()
  })

  it('ミュージックビデオは今までどおり（楽曲が無ければ何も出さない）', () => {
    const { focusPanel } = setup({ track: null, shots: [] }, { ready: true, skipInitial: false })
    expect(focusPanel).not.toHaveBeenCalled()
  })
})
