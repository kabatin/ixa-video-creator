import { screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ShotInspector } from '@/components/workbench/inspector/shot-inspector'
import { aWorkbenchShot, renderInWorkbench } from './workbench-fixture'

/**
 * Shot のインスペクターの並び（制作者 2026-10-03「データの並びが雑なので整理したい。普段触らないような詳細設定は
 * 下のほうで、たとえば Take 作成より先にやるべき画像生成を上のほうに持ってくるとか、順序に応じて並び替えたり整理」）。
 * 作業の順（絵コンテ → 参照 → 絵 → Take を作る → Take）に並べ、時間は下、普段触らないものは畳む。
 */

vi.mock('@/components/workbench/inspector/shot-generate-section', () => ({ ShotGenerateSection: () => null }))
vi.mock('@/components/workbench/inspector/start-frame-field', () => ({ StartFrameField: () => null }))
vi.mock('@/components/workbench/inspector/shot-cast-section', () => ({ ShotCastSection: () => null }))
vi.mock('@/components/workbench/inspector/footage-import-form', () => ({ FootageImportForm: () => null }))
vi.mock('@/components/workbench/inspector/take-timing-field', () => ({ TakeTimingField: () => null }))
vi.mock('@/components/workbench/inspector/shot-storyboard-section', () => ({ ShotStoryboardSection: () => null }))
vi.mock('@/components/workbench/use-shot-takes', () => ({ useShotTakes: () => ({ takes: [] }) }))
vi.mock('@/components/review-panel', () => ({ ReviewPanel: () => null }))

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

describe('ShotInspector の並び', () => {
  it('作業の順に並べる: 絵コンテ → 参照 → 絵 → Take を作る → Take → 時間', () => {
    const shot = aWorkbenchShot(1)
    renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot] })

    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      '絵コンテ',
      '参照',
      '絵',
      'Take を作る',
      'Take',
      '時間',
    ])
  })

  it('普段触らないもの（カメラなどの詳しい設定・レビュー）は下に畳んである', () => {
    const shot = aWorkbenchShot(1)
    renderInWorkbench(<ShotInspector shot={shot} isFirst />, { shots: [shot] })

    for (const title of ['詳しい設定', 'レビュー']) {
      const summary = screen.getByText(title, { selector: 'summary *, summary' })
      expect(summary.closest('details')?.open).toBe(false)
    }
  })
})
