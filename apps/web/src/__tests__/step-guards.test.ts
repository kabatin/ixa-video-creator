import { describe, expect, it } from 'vitest'
import { DRAW_ANYWAY_LABEL, drawWithoutStoryboardWarning } from '@/lib/step-guards'

/**
 * 手順を飛ばしたときの確認（制作者 2026-10-03「画像作る時、絵コンテがないと想定した画像が出て来ない可能性が高いのだが、
 * これも結構忘れてしまいがち」「手順を飛び越えて作業をしようとしている場合には警告ダイアログを出して、任意の上で実行」）。
 * 絵コンテが空かは**説明だけ**で見る（`lacksStoryboard` は最初のフレームがあると false になるので使わない）。
 */
describe('drawWithoutStoryboardWarning', () => {
  it('説明が全部あれば確認しない（null）', () => {
    expect(drawWithoutStoryboardWarning([{ code: 'CUT-01', description: '屋上' }])).toBeNull()
  })

  it('1 件で説明が空なら、その Shot の名前で言う。空白だけも空と見る', () => {
    const message = drawWithoutStoryboardWarning([{ code: 'CUT-03', description: '  ' }])
    expect(message).toContain('CUT-03')
    expect(message).toContain('絵コンテ（説明）がまだ空')
  })

  it('まとめて作るときは、空の件数を数える', () => {
    const message = drawWithoutStoryboardWarning([
      { code: 'CUT-01', description: '屋上' },
      { code: 'CUT-02', description: '' },
      { code: 'CUT-03', description: '' },
    ])
    expect(message).toContain('3 件のうち 2 件')
  })

  it('確認のボタンは「このまま作る」', () => {
    expect(DRAW_ANYWAY_LABEL).toBe('このまま作る')
  })
})
