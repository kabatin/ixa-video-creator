import { screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ShotInspector } from '@/components/workbench/inspector/shot-inspector'
import { aWorkbenchShot, renderInWorkbench } from './workbench-fixture'

/**
 * Shot のインスペクターから Take を作る（制作者 2026-09-30「Take を作るところでどうやって作るか迷った」）。
 * 作る欄は一番下にあり、スクロールしないと見えなかった。**欄を一番上に置き、名前も「Take を作る」にする。**
 */

vi.mock('@/components/workbench/inspector/shot-generate-section', () => ({
  ShotGenerateSection: () => <p>作る欄の中身</p>,
}))
vi.mock('@/components/workbench/inspector/start-frame-field', () => ({
  StartFrameField: () => null,
}))
vi.mock('@/components/workbench/inspector/shot-cast-section', () => ({
  ShotCastSection: () => null,
}))
vi.mock('@/components/workbench/inspector/footage-import-form', () => ({
  FootageImportForm: () => null,
}))
vi.mock('@/components/workbench/inspector/take-timing-field', () => ({
  TakeTimingField: () => null,
}))
vi.mock('@/components/workbench/use-shot-takes', () => ({ useShotTakes: () => ({ takes: [] }) }))
vi.mock('@/components/review-panel', () => ({ ReviewPanel: () => null }))

// jsdom には無い。欄へ送る動きそのものはブラウザで確かめる。
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

describe('ShotInspector の Take を作る', () => {
  /**
   * 下に置いた欄へ送る形では、上の欄（Take の一覧・最初のフレーム）が遅れて読み込まれて押し下げられ、
   * 欄が画面の下で切れていた。**欄そのものを一番上に置く。**
   */
  it('Take を作る欄が一番上にある', () => {
    const shot = aWorkbenchShot(1)
    renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot] })

    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent)
    expect(headings[0]).toBe('Take を作る')
  })

  it('作る欄の見出しは「Take を作る」', () => {
    const shot = aWorkbenchShot(1)
    renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot] })

    expect(screen.getByRole('heading', { name: 'Take を作る' })).toBeInTheDocument()
  })
})
