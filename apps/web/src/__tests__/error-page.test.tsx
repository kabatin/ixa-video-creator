import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ErrorPage from '@/app/error'

/**
 * 想定外の例外の画面は、**原因を決めつけない。**
 *
 * この境界は通信の失敗も画面の不具合も受ける。以前は一律に「通信か API 側の問題です」と
 * 出していたが、スマホ幅での無限更新（画面の不具合）でも同じ文が出て、利用者を
 * 通信の確認へ向かわせた（390px で実測）。
 */
describe('ErrorPage', () => {
  it('画面の不具合でも「API 側の問題」と言い切らない', () => {
    render(<ErrorPage error={new Error('Maximum update depth exceeded.')} reset={vi.fn()} />)

    expect(screen.queryByText(/API 側の問題です/)).toBeNull()
    expect(screen.getByText(/画面の不具合/)).toBeTruthy()
  })

  it('直らないときに何をすればよいかを言う', () => {
    render(<ErrorPage error={new Error('x')} reset={vi.fn()} />)

    expect(screen.getByText(/知らせてください/)).toBeTruthy()
  })
})
