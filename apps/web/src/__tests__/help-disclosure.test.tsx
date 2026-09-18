import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HelpDisclosure } from '@/components/ui/help-disclosure'

/**
 * 説明を「?」へ畳む部品。
 *
 * **畳むのであって、消すのではない。** `hidden` で消すと、キーボードだけで
 * 操作する人や読み上げが説明へ辿り着けなくなる。`<details>` なら閉じていても
 * 木の中に残り、開けば読める。
 */
describe('HelpDisclosure', () => {
  it('既定では閉じている', () => {
    render(
      <HelpDisclosure label="キーの割り当て">
        <p>Space で再生</p>
      </HelpDisclosure>,
    )

    expect(screen.getByRole('group')).not.toHaveAttribute('open')
  })

  /** 閉じていても中身は木の中にある。消すと読み上げから辿り着けない。 */
  it('閉じていても中身は消さない', () => {
    render(
      <HelpDisclosure label="キーの割り当て">
        <p>Space で再生</p>
      </HelpDisclosure>,
    )

    expect(screen.getByText('Space で再生')).toBeInTheDocument()
  })

  it('押すと開く', () => {
    render(
      <HelpDisclosure label="キーの割り当て">
        <p>Space で再生</p>
      </HelpDisclosure>,
    )

    fireEvent.click(screen.getByText(/キーの割り当て/))

    expect(screen.getByRole('group')).toHaveAttribute('open')
  })

  /** 記号だけでは何が開くか分からない。何の説明かを必ず文字で書く。 */
  it('何の説明かを文字で出す', () => {
    render(
      <HelpDisclosure label="ビート吸着の使い方">
        <p>本文</p>
      </HelpDisclosure>,
    )

    expect(screen.getByText(/ビート吸着の使い方/)).toBeInTheDocument()
  })

  it('閉じていると困る場所は既定で開ける', () => {
    render(
      <HelpDisclosure label="使い方" defaultOpen>
        <p>本文</p>
      </HelpDisclosure>,
    )

    expect(screen.getByRole('group')).toHaveAttribute('open')
  })
})
