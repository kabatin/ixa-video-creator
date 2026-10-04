import { ProjectId, newId } from '@ixa/domain'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectCardFrame, ProjectListActions, type ProjectListActionsApi } from '@/components/project-list-actions'

/**
 * 作品一覧から複製・削除する（制作者 2026-10-04「プロジェクト一覧でプロジェクト削除出来るようにしてほしい。複製もプロジェクト一覧からも
 * 出来るといい」）。カードの「…」と右クリックで同じメニューを出す。カードを押したときの行き先（ワークベンチ）は変えない。
 */

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const PROJECT = { id: newId(ProjectId), name: '進め！戦子ちゃん！' }

const fakeApi = (): ProjectListActionsApi => ({
  deleteProject: vi.fn(() => Promise.resolve()),
  duplicateProject: vi.fn(),
})

const show = (api: ProjectListActionsApi = fakeApi()) => {
  render(
    <ProjectListActions api={api}>
      <ul>
        <ProjectCardFrame project={PROJECT}>
          <a href="/projects/x">進め！戦子ちゃん！</a>
        </ProjectCardFrame>
      </ul>
    </ProjectListActions>,
  )
  return api
}

beforeEach(() => {
  router.push.mockReset()
  router.refresh.mockReset()
})

describe('作品一覧の操作', () => {
  it('「…」で「複製…」「削除…」のメニューを出す', async () => {
    show()

    await userEvent.click(screen.getByRole('button', { name: '進め！戦子ちゃん！ の操作' }))

    const menu = screen.getByRole('menu', { name: '進め！戦子ちゃん！ の操作' })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['複製…', '削除…'])
  })

  it('カードを右クリックしても同じメニューが出る', () => {
    show()

    fireEvent.contextMenu(screen.getByRole('link', { name: '進め！戦子ちゃん！' }))

    expect(screen.getByRole('menu', { name: '進め！戦子ちゃん！ の操作' })).toBeInTheDocument()
  })

  it('削除は、消えるものを書いた確認のあとで消し、一覧を読み直して知らせる', async () => {
    const api = show()

    await userEvent.click(screen.getByRole('button', { name: '進め！戦子ちゃん！ の操作' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '削除…' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('プロジェクト「進め！戦子ちゃん！」を削除します。元に戻せません。')
    expect(dialog).toHaveTextContent('キャラクター・ロケーション・ブランド資産も見えなくなります')
    expect(api.deleteProject).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: '削除する' }))

    await waitFor(() => {
      expect(api.deleteProject).toHaveBeenCalledWith(PROJECT.id)
    })
    expect(router.refresh).toHaveBeenCalled()
    expect(await screen.findByText('「進め！戦子ちゃん！」を削除しました')).toBeInTheDocument()
  })

  it('確認で「やめる」なら消さない', async () => {
    const api = show()

    await userEvent.click(screen.getByRole('button', { name: '進め！戦子ちゃん！ の操作' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '削除…' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'やめる' }))

    expect(api.deleteProject).not.toHaveBeenCalled()
  })

  it('「複製…」で複製の画面を開く（名前は「のコピー」）', async () => {
    show()

    await userEvent.click(screen.getByRole('button', { name: '進め！戦子ちゃん！ の操作' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '複製…' }))

    expect(screen.getByRole('textbox', { name: '名前' })).toHaveValue('進め！戦子ちゃん！のコピー')
  })
})
