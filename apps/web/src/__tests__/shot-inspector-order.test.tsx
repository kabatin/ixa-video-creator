import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CharacterId } from '@ixa/domain'
import { ShotInspector } from '@/components/workbench/inspector/shot-inspector'
import { aWorkbenchShot, renderInWorkbench } from './workbench-fixture'

/**
 * Shot のインスペクターの並び（制作者 2026-10-03「データの並びが雑なので整理したい。普段触らないような詳細設定は
 * 下のほうで、たとえば Take 作成より先にやるべき画像生成を上のほうに持ってくるとか、順序に応じて並び替えたり整理」）。
 *
 * 2026-10-26「インスペクターが雑多になりすぎて縦長だし区切りも良く分からない」: 区切りを畳める見出しの行にし、
 * 上に目次を置いた。「Take を作る」「Take」「声の差し替え」は 1 つの「Take」にまとめた。
 */

vi.mock('@/components/workbench/inspector/shot-generate-section', () => ({ ShotGenerateSection: () => null }))
vi.mock('@/components/workbench/inspector/start-frame-field', () => ({ StartFrameField: () => null }))
vi.mock('@/components/workbench/inspector/end-frame-field', () => ({ EndFrameField: () => null }))
vi.mock('@/components/workbench/inspector/shot-cast-section', () => ({ ShotCastSection: () => null }))
vi.mock('@/components/workbench/inspector/shot-dialogue-section', () => ({ ShotDialogueSection: () => null }))
vi.mock('@/components/workbench/inspector/shot-dub-section', () => ({ ShotDubSection: () => <p>差し替えの中身</p> }))
vi.mock('@/components/workbench/use-shot-dub', () => ({ useShotDub: () => ({ state: null, error: null, busy: false }) }))
vi.mock('@/components/workbench/inspector/footage-import-form', () => ({ FootageImportForm: () => null }))
vi.mock('@/components/workbench/inspector/take-timing-field', () => ({ TakeTimingField: () => null }))
vi.mock('@/components/workbench/inspector/shot-storyboard-section', () => ({ ShotStoryboardSection: () => null }))
vi.mock('@/components/workbench/use-shot-takes', () => ({ useShotTakes: () => ({ takes: [], error: null }) }))
vi.mock('@/components/review-panel', () => ({ ReviewPanel: () => null }))

const scrollIntoView = vi.fn()
beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView
})
beforeEach(() => {
  window.localStorage.clear()
  scrollIntoView.mockClear()
})

/** 見出しの題（矢印と、畳んだときに添える「（要約）」を除く）。 */
const titles = (): string[] =>
  screen.getAllByRole('heading').map((heading) => (heading.textContent ?? '').replace(/^▸/, '').replace(/（.*）$/, ''))

/** 区切りの見出しの開け閉めボタン（目次の同じ名前のボタンと取り違えない）。 */
const toggleOf = (title: string): HTMLElement =>
  within(screen.getByRole('heading', { name: new RegExp(`^${title}(（|$)`) })).getByRole('button')

const aLine = { speakerId: CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'), text: 'ねえ', offscreen: false, translation: null }

describe('ShotInspector の並び', () => {
  it('作業の順に並べる: 絵コンテ → 参照 → セリフ → 絵 → Take → 時間 → 詳しい設定 → レビュー', () => {
    const shot = aWorkbenchShot(1)
    renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot] })

    expect(titles()).toEqual(['絵コンテ', '参照', 'セリフ', '絵', 'Take', '時間', '詳しい設定', 'レビュー'])
  })

  it('既定の開け閉め: 絵コンテ・参照・Take と、最初のフレームが無い絵は開き、時間・詳しい設定・レビューは畳む', () => {
    const shot = aWorkbenchShot(1)
    renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot] })

    for (const title of ['絵コンテ', '参照', '絵', 'Take']) {
      expect(toggleOf(title)).toHaveAttribute('aria-expanded', 'true')
    }
    // セリフは行が無ければ畳む。
    for (const title of ['セリフ', '時間', '詳しい設定', 'レビュー']) {
      expect(toggleOf(title)).toHaveAttribute('aria-expanded', 'false')
    }
  })

  it('畳んだ区切りは見出しに要約を出す（セリフの行数・時間）', () => {
    const shot = aWorkbenchShot(1, { startSec: 0, durationSec: 6 })
    renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot] })

    expect(toggleOf('時間').textContent).toContain('0:00.00 / 6.00s')
    expect(toggleOf('セリフ').textContent).toContain('なし')
  })

  it('セリフがあればセリフを開き、Take の中に声の差し替えを出す', () => {
    const shot = aWorkbenchShot(1, { dialogue: [aLine, aLine] })
    renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot] })

    expect(toggleOf('セリフ')).toHaveAttribute('aria-expanded', 'true')
    const take = toggleOf('Take').closest('section')
    expect(take).not.toBeNull()
    expect(within(take as HTMLElement).getByText('差し替えの中身')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'セリフ 2' })).toBeInTheDocument()
  })

  it('セリフが無ければ声の差し替えを出さない', () => {
    const shot = aWorkbenchShot(1)
    renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot] })

    expect(screen.queryByText('差し替えの中身')).toBeNull()
  })
})

describe('ShotInspector の目次', () => {
  it('目次の「時間」を押すと、畳んだ時間の区切りを開いてそこへ送る', async () => {
    const shot = aWorkbenchShot(1)
    renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot] })
    expect(toggleOf('時間')).toHaveAttribute('aria-expanded', 'false')
    scrollIntoView.mockClear()

    const toc = screen.getByRole('navigation', { name: 'インスペクターの目次' })
    await userEvent.click(within(toc).getByRole('button', { name: '時間' }))

    expect(toggleOf('時間')).toHaveAttribute('aria-expanded', 'true')
    expect(scrollIntoView.mock.contexts).toContain(toggleOf('時間').closest('section'))
  })

  it('目次に区切りが並ぶ（Take は本数を添える）', () => {
    const shot = aWorkbenchShot(1)
    renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot] })

    const toc = screen.getByRole('navigation', { name: 'インスペクターの目次' })
    expect(within(toc).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '絵コンテ',
      '参照',
      'セリフ',
      '絵',
      'Take 0本',
      '時間',
      '詳しい設定',
      'レビュー',
    ])
  })
})
