import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsDialogBody } from '@/components/workbench/dialogs/settings-dialog'
import { renderInWorkbench } from './workbench-fixture'

/**
 * プロジェクト設定の並び。**取り返しのつかない「プロジェクトの削除」は一番下。**
 * 保存ボタンと「接続先と実行の設定」の間に挟まっていた（制作者の指摘 2026-09-30）。
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/components/environment-panel', () => ({
  EnvironmentPanel: () => <p>接続先の中身</p>,
}))

describe('SettingsDialogBody', () => {
  it('プロジェクトの削除は、接続先と実行の設定より後ろ（一番下）', () => {
    renderInWorkbench(<SettingsDialogBody />)

    const environment = screen.getByRole('heading', { name: '接続先と実行の設定' })
    const deletion = screen.getByRole('heading', { name: 'プロジェクトの削除' })
    expect(
      environment.compareDocumentPosition(deletion) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent)
    expect(headings.at(-1)).toBe('プロジェクトの削除')
  })
})
