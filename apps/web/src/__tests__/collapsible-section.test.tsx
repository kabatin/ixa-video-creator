import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollapsibleSection, InfoTip, SectionToc } from '@/components/workbench/ui/collapsible-section'
import { sectionStorageKey } from '@/lib/section-open-state'

/**
 * 畳める区切りと目次（制作者 2026-10-26「インスペクターが雑多になりすぎて縦長だし区切りも良く分からない」）。
 * 見出しを太く・畳んだら 1 行の要約を出す・開け閉めを覚える（覚えられない端末でも動く）。
 */

const KEY = sectionStorageKey('shot', 'time')

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

const time = (defaultOpen: boolean, openSignal = 0) => (
  <CollapsibleSection
    scope="shot"
    id="time"
    title="時間"
    summary="0:00.00 / 6.00s"
    defaultOpen={defaultOpen}
    openSignal={openSignal}
  >
    <p>中身</p>
  </CollapsibleSection>
)

describe('CollapsibleSection', () => {
  it('畳んでいると見出しに要約を添え、中身を隠す', () => {
    render(time(false))
    const toggle = screen.getByRole('button', { name: /時間/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.textContent).toContain('0:00.00 / 6.00s')
    expect(screen.getByText('中身').closest('[hidden]')).not.toBeNull()
  })

  it('開いていると要約を出さず、見出しの名前は題だけ', () => {
    render(time(true))
    expect(screen.getByRole('heading', { name: '時間' })).toBeInTheDocument()
    expect(screen.getByText('中身').closest('[hidden]')).toBeNull()
  })

  it('開け閉めを覚え、次に出したときは既定より覚えた方を使う', async () => {
    const first = render(time(false))
    await userEvent.click(screen.getByRole('button', { name: /時間/ }))
    expect(screen.getByRole('button', { name: '時間' })).toHaveAttribute('aria-expanded', 'true')
    expect(window.localStorage.getItem(KEY)).toBe('open')
    first.unmount()

    render(time(false))
    expect(screen.getByRole('button', { name: '時間' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('覚えた「閉じる」は既定の「開く」より強い', () => {
    window.localStorage.setItem(KEY, 'closed')
    render(time(true))
    expect(screen.getByRole('button', { name: /時間/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('localStorage が使えなくても（例外を投げても）既定で出し、開け閉めできる', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    render(time(false))
    const toggle = screen.getByRole('button', { name: /時間/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: '時間' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('開く合図が来たら開く（目次やメニューから来たとき）', () => {
    const view = render(time(false, 0))
    expect(screen.getByRole('button', { name: /時間/ })).toHaveAttribute('aria-expanded', 'false')
    view.rerender(time(false, 1))
    expect(screen.getByRole('button', { name: '時間' })).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('SectionToc', () => {
  it('押した区切りの id を渡す', async () => {
    const onJump = vi.fn()
    render(
      <SectionToc
        items={[
          { id: 'dialogue', label: 'セリフ 2' },
          { id: 'take', label: 'Take 3本' },
        ]}
        onJump={onJump}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Take 3本' }))
    expect(onJump).toHaveBeenCalledWith('take')
    expect(screen.getByRole('navigation', { name: 'インスペクターの目次' })).toBeInTheDocument()
  })
})

describe('InfoTip', () => {
  it('説明は押すまで出さず、読み上げには渡す', async () => {
    render(<InfoTip label="速さ">AI には 1.80s で頼みます。</InfoTip>)
    const button = screen.getByRole('button', { name: '速さの説明' })
    expect(button).toHaveAccessibleDescription('AI には 1.80s で頼みます。')
    expect(screen.getByText('AI には 1.80s で頼みます。').closest('[hidden]')).not.toBeNull()
    await userEvent.click(button)
    expect(screen.getByText('AI には 1.80s で頼みます。').closest('[hidden]')).toBeNull()
  })
})
