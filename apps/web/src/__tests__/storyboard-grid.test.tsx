import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoryboardGrid } from '@/components/workbench/storyboard-grid'
import { storyboardColumns } from '@/lib/storyboard-grid'
import { aWorkbenchShot } from './workbench-fixture'

/**
 * ストーリーボードの列数（UI-WORKBENCH §5.3 / §10）。
 * **画面幅ではなく、割り当てられた区画の幅で決まる**（lessons L-025）。
 */

describe('storyboardColumns', () => {
  it.each([
    [1200, 3],
    [720, 3],
    [719, 2],
    [480, 2],
    [479, 1],
    [400, 1],
    [0, 1],
  ])('区画 %ipx → %i 列', (width, columns) => {
    expect(storyboardColumns(width)).toBe(columns)
  })

  it('どれだけ広くても 4 列にはしない（D6）', () => {
    expect(storyboardColumns(4000)).toBe(3)
  })
})

/** ResizeObserver の偽物。`resize(幅)` で区画の幅を変える。 */
let observed: ((width: number) => void) | null = null

beforeEach(() => {
  observed = null
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }
      observe(): void {
        observed = (width) => {
          this.callback(
            [{ contentRect: { width } } as unknown as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          )
        }
      }
      disconnect(): void {
        observed = null
      }
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const shots = [1, 2, 3, 4].map((index) => aWorkbenchShot(index))

describe('StoryboardGrid', () => {
  it.each([
    [720, '3'],
    [480, '2'],
    [400, '1'],
  ])('区画の幅 %ipx で %s 列', (width, columns) => {
    render(<StoryboardGrid shots={shots} posters={new Map()} selectedShotId={null} onSelect={vi.fn()} />)
    act(() => {
      observed?.(width)
    })
    const grid = screen.getByRole('list', { name: 'ストーリーボード' })
    expect(grid).toHaveAttribute('data-columns', columns)
    expect(grid.style.gridTemplateColumns).toBe(`repeat(${columns}, minmax(0, 1fr))`)
  })

  it('画面幅（innerWidth）が広くても、区画が狭ければ 1 列', () => {
    vi.stubGlobal('innerWidth', 1920)
    render(<StoryboardGrid shots={shots} posters={new Map()} selectedShotId={null} onSelect={vi.fn()} />)
    act(() => {
      observed?.(400)
    })
    expect(screen.getByRole('list', { name: 'ストーリーボード' })).toHaveAttribute('data-columns', '1')
  })

  it('選択中のカードは ring-accent、押すと選ぶ', () => {
    const onSelect = vi.fn()
    render(
      <StoryboardGrid shots={shots} posters={new Map()} selectedShotId={shots[1]?.id ?? null} onSelect={onSelect} />,
    )
    const cards = screen.getAllByRole('button')
    expect(cards[1]).toHaveAttribute('aria-pressed', 'true')
    expect(cards[1]?.className).toContain('ring-accent')
    cards[2]?.click()
    expect(onSelect).toHaveBeenCalledWith(shots[2]?.id)
  })

  it('前の Shot から繋ぐ Shot には鎖を出す（先頭には出さない）', () => {
    const chained = [
      aWorkbenchShot(1, { continuityMode: 'previous_shot' }),
      aWorkbenchShot(2, { continuityMode: 'previous_shot' }),
    ]
    render(<StoryboardGrid shots={chained} posters={new Map()} selectedShotId={null} onSelect={vi.fn()} />)
    expect(screen.getAllByLabelText('前の Shot と接続')).toHaveLength(1)
  })

  it('カードに時間と状態の名前が出る', () => {
    render(<StoryboardGrid shots={shots.slice(0, 1)} posters={new Map()} selectedShotId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('CUT-01')).toBeInTheDocument()
    expect(screen.getByText(/0:04\.00 – 0:08\.00（4\.00s）/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '下書き' })).toBeInTheDocument()
  })

  /** Shot を作った後に、Take をどこで作るか迷った（制作者 2026-09-30）。カードから直接行けるようにする。 */
  describe('Take を作る', () => {
    const cards = [
      aWorkbenchShot(1, { status: 'draft' }),
      aWorkbenchShot(2, { status: 'ready' }),
      aWorkbenchShot(3, { status: 'approved' }),
      aWorkbenchShot(4, { status: 'generating' }),
    ]

    it('Take がまだ無い Shot（下書き・生成可能）にだけ出し、押すとその Shot で知らせる', () => {
      const onMakeTake = vi.fn()
      render(
        <StoryboardGrid shots={cards} posters={new Map()} selectedShotId={null} onSelect={vi.fn()} onMakeTake={onMakeTake} />,
      )

      const buttons = screen.getAllByRole('button', { name: /Take を作る/ })
      expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
        'CUT-01 の Take を作る',
        'CUT-02 の Take を作る',
      ])
      buttons[1]?.click()
      expect(onMakeTake).toHaveBeenCalledWith(cards[1]?.id)
    })

    it('口を渡さなければ出さない（見るだけの画面）', () => {
      render(<StoryboardGrid shots={cards} posters={new Map()} selectedShotId={null} onSelect={vi.fn()} />)

      expect(screen.queryByRole('button', { name: /Take を作る/ })).toBeNull()
    })
  })

  /** 「生成中」の点だけでは分からなかった（制作者 2026-09-30）。カードの下に様子を 1 行で出す。 */
  it('生成中の Shot には、様子の 1 行（作成中 2:31 / 約 4 分 など）を出す', () => {
    const cards = [aWorkbenchShot(1, { status: 'generating' }), aWorkbenchShot(2, { status: 'draft' })]
    render(
      <StoryboardGrid
        shots={cards}
        posters={new Map()}
        selectedShotId={null}
        onSelect={vi.fn()}
        onMakeTake={vi.fn()}
        activityOf={(shotId) => (shotId === cards[0]?.id ? '作成中 2:31 / 約 4 分' : null)}
      />,
    )

    expect(screen.getByText('作成中 2:31 / 約 4 分')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Take を作る/ })).toHaveLength(1)
  })

  /** 制作者 2026-10-01「動画生成をキャンセル出来るようにしたい、もし出来るならUIが分かりづらい」。 */
  it('生成中の Shot にだけ「生成をやめる」を出し、押すとその Shot で知らせる', () => {
    const cards = [aWorkbenchShot(1, { status: 'generating' }), aWorkbenchShot(2, { status: 'draft' })]
    const onCancelGeneration = vi.fn()
    render(
      <StoryboardGrid
        shots={cards}
        posters={new Map()}
        selectedShotId={null}
        onSelect={vi.fn()}
        onCancelGeneration={onCancelGeneration}
      />,
    )

    const buttons = screen.getAllByRole('button', { name: /生成をやめる/ })
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['CUT-01 の生成をやめる'])
    buttons[0]?.click()
    expect(onCancelGeneration).toHaveBeenCalledWith(cards[0])
  })
})
