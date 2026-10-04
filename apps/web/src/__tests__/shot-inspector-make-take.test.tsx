import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ShotInspector } from '@/components/workbench/inspector/shot-inspector'
import { aWorkbenchShot, renderInWorkbench } from './workbench-fixture'

/**
 * Shot のインスペクターから Take を作る（制作者 2026-09-30「Take を作るところでどうやって作るか迷った」）。
 * 作る欄は一番下にあり、スクロールしないと見えなかった。名前を「Take を作る」にし、メニューから来たらその欄へ送る。
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
const scrollIntoView = vi.fn()
beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView
})

describe('ShotInspector の Take を作る', () => {
  /**
   * 並びは作業の順（制作者 2026-10-03。絵コンテ → 参照 → 絵 → Take を作る）に戻したので、「Take を作る…」から来たら
   * その欄まで送る。上の欄が遅れて読み込まれて押し下げられても、少しの間は送り直す（2026-09-30 に欄が下で切れた）。
   */
  it('「Take を作る…」から来たら、Take を作る欄へ送る', () => {
    const shot = aWorkbenchShot(1)
    scrollIntoView.mockClear()
    renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot], inspectorTab: 'generate' })

    const target = screen.getByRole('heading', { name: 'Take を作る' }).closest('section')?.parentElement
    expect(scrollIntoView.mock.contexts).toContain(target)
  })

  it('作る欄の見出しは「Take を作る」', () => {
    const shot = aWorkbenchShot(1)
    renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot] })

    expect(screen.getByRole('heading', { name: 'Take を作る' })).toBeInTheDocument()
  })

  /** インスペクターの「…」も、右クリックと同じ中身（2026-09-30）。 */
  it('「…」は右クリックと同じ Shot のメニューを開く', async () => {
    const shot = aWorkbenchShot(1)
    renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot] })

    await userEvent.click(screen.getByRole('button', { name: `${shot.code} のその他の操作` }))

    // 行の名前だけ（押せない理由は名前の下に添えてある）。
    const labels = screen.getAllByRole('menuitem').map((item) => item.firstChild?.firstChild?.textContent)
    expect(labels).toEqual(['Take を作る…', '生成をやめる', 'Take 比較で見る', '絵コンテの画像を AI で作る', '再生位置で分割', '採用を外す', '削除…'])
  })
})

/**
 * 上の欄が遅れて伸びる間は送り直すが、**利用者が自分で動かしたら追わない**（レビューで見つけた。Shot を選んですぐ
 * スクロールすると、欄が読み込まれて伸びるたびに引き戻されていた）。一番上（絵コンテ）を頼まれたときは追わない。
 */
describe('ShotInspector: 送り直し', () => {
  it('伸びたら送り直し、ホイールで動かしたらやめる', () => {
    const callbacks: (() => void)[] = []
    const original = globalThis.ResizeObserver
    // 本物と同じく、disconnect したら呼ばない。
    globalThis.ResizeObserver = class {
      private active = true
      constructor(callback: () => void) {
        callbacks.push(() => {
          if (this.active) callback()
        })
      }
      observe(): void {}
      disconnect(): void {
        this.active = false
      }
      unobserve(): void {}
    } as unknown as typeof ResizeObserver
    try {
      const shot = aWorkbenchShot(1)
      renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot], inspectorTab: 'generate' })
      scrollIntoView.mockClear()

      callbacks.forEach((callback) => callback())
      expect(scrollIntoView).toHaveBeenCalledTimes(1)

      const body = screen.getByRole('heading', { name: 'Take を作る' }).closest('.workbench-panel-body')
      body?.dispatchEvent(new Event('wheel', { bubbles: true }))
      scrollIntoView.mockClear()
      callbacks.forEach((callback) => callback())
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      globalThis.ResizeObserver = original
    }
  })
})

