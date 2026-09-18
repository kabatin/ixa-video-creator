import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RowMenu } from '@/components/row-menu'

/**
 * **消す操作を、よく使う操作の隣に置かない。**
 *
 * Shot 一覧は「Take を見る」のすぐ下に赤い削除ボタンが並んでおり、
 * 制作者から「近すぎて怖い」と報告があった（2026-09-18）。
 * 確認を挟んであっても、押し間違えた次の一手で消える位置は危ない。
 * **一手ぶん遠ざけたこと**を固定する。
 */
describe('RowMenu', () => {
  it('開くまで中身を出さない', () => {
    render(
      <RowMenu label="CUT-01 のその他の操作">
        <button type="button">削除</button>
      </RowMenu>,
    )

    // `<details>` は閉じている間、中身を隠す。
    expect(screen.getByRole('group')).not.toHaveAttribute('open')
  })

  it('押すと開く', () => {
    render(
      <RowMenu label="CUT-01 のその他の操作">
        <button type="button">削除</button>
      </RowMenu>,
    )

    fireEvent.click(screen.getByLabelText('CUT-01 のその他の操作'))

    expect(screen.getByRole('group')).toHaveAttribute('open')
  })

  /** 行をいくつも開いたままにすると、どの行の操作なのかが分からなくなる。 */
  it('外を触ると閉じる', () => {
    render(
      <div>
        <RowMenu label="CUT-01 のその他の操作">
          <button type="button">削除</button>
        </RowMenu>
        <span data-testid="outside">外</span>
      </div>,
    )
    const menu = screen.getByRole('group')
    fireEvent.click(screen.getByLabelText('CUT-01 のその他の操作'))
    expect(menu).toHaveAttribute('open')

    fireEvent.pointerDown(screen.getByTestId('outside'))

    expect(menu).not.toHaveAttribute('open')
  })

  it('中を触っても閉じない（確認を押す前に消えない）', () => {
    render(
      <RowMenu label="CUT-01 のその他の操作">
        <button type="button">削除</button>
      </RowMenu>,
    )
    const menu = screen.getByRole('group')
    fireEvent.click(screen.getByLabelText('CUT-01 のその他の操作'))

    fireEvent.pointerDown(screen.getByRole('button', { name: '削除' }))

    expect(menu).toHaveAttribute('open')
  })

  /** 行ごとに違う文にしないと、読み上げでどの行か分からない。 */
  it('何の行のメニューかを読み上げに伝える', () => {
    render(
      <RowMenu label="CUT-07 のその他の操作">
        <button type="button">削除</button>
      </RowMenu>,
    )

    expect(screen.getByLabelText('CUT-07 のその他の操作')).toBeInTheDocument()
  })
})
