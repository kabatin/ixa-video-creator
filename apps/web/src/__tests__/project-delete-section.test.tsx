import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectDeleteSection } from '@/components/project-delete-section'
import { aProject } from './workbench-fixture'

/**
 * プロジェクトを消す前の確認。キャラクター・ロケーション・ブランド資産はプロジェクトごとになった（ADR-0034）ので、
 * 「ワークスペースのものなので残ります」は誤り。一緒に見えなくなると言い、ほかで使うなら先に取り込むよう言う。
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

describe('ProjectDeleteSection', () => {
  it('キャラクターなども一緒に見えなくなると言う（残るとは言わない）', async () => {
    render(<ProjectDeleteSection project={aProject} />)

    await userEvent.click(screen.getByRole('button', { name: '削除（プロジェクト）' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toMatch(/キャラクター・ロケーション・ブランド資産も見えなくなります/)
    expect(dialog.textContent).toMatch(/ほかのプロジェクトから取り込む/)
    expect(dialog.textContent).not.toMatch(/残ります/)
  })
})
