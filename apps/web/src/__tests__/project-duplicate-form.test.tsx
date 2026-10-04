import { DUPLICATION_ITEMS, ProjectId, newId } from '@ixa/domain'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectDuplicateForm } from '@/components/project-duplicate-form'
import type { ProjectDuplicateApi, WireDuplicatedProject } from '@/lib/project-duplicate-api'

/**
 * 作品を複製する画面（制作者 2026-10-04「持って行きたいところだけ持っていけるようにすると超便利」）。
 * 既定は全部オン。頼る項目を外すと、それに頼る項目も外れて押せなくなり、理由が出る。
 */

const SOURCE = { id: newId(ProjectId), name: '進め！戦子ちゃん！' }
const COPIED = newId(ProjectId)

const resultWith = (notes: readonly string[]): WireDuplicatedProject =>
  ({ project: { id: COPIED, name: '進め！戦子ちゃん！のコピー' }, notes: [...notes] }) as unknown as WireDuplicatedProject

const show = (api: ProjectDuplicateApi, onOpen = vi.fn()) => {
  render(<ProjectDuplicateForm source={SOURCE} api={api} onOpen={onOpen} onCancel={vi.fn()} />)
  return { onOpen }
}

const apiReturning = (notes: readonly string[] = []): ProjectDuplicateApi => ({
  duplicateProject: vi.fn(() => Promise.resolve(resultWith(notes))),
})

describe('ProjectDuplicateForm', () => {
  it('名前は「のコピー」、項目は全部オン。いつも引き継ぐもの・持っていかないものを書く', () => {
    show(apiReturning())

    expect(screen.getByRole('textbox', { name: '名前' })).toHaveValue('進め！戦子ちゃん！のコピー')
    for (const label of ['作品の方針', '楽曲（解析・セクションも）', 'テロップ', 'キャラクター', 'Shot', 'Take']) {
      expect(screen.getByRole('checkbox', { name: new RegExp(`^${label.replace(/[（）]/g, '.')}`) })).toBeChecked()
    }
    expect(screen.getByText(/いつも引き継ぐもの: 画面の形・大きさ・fps・予算/)).toBeInTheDocument()
    expect(screen.getByText(/持っていかないもの:.*AI の絵コンテの案/)).toBeInTheDocument()
  })

  it('Shot を外すと、絵コンテ・絵・Take も外れて押せなくなり、理由が出る', async () => {
    show(apiReturning())

    await userEvent.click(screen.getByRole('checkbox', { name: /^Shot/ }))

    for (const label of [/^絵コンテ/, /^絵.最初のフレーム/, /^Take/]) {
      const box = screen.getByRole('checkbox', { name: label })
      expect(box).not.toBeChecked()
      expect(box).toBeDisabled()
    }
    expect(screen.getAllByText('Shot を持っていくときだけ選べます')).toHaveLength(3)
  })

  it('楽曲を外すと歌詞の時刻が外れ、戻すと選べるようになる（自分では入らない）', async () => {
    show(apiReturning())
    const music = screen.getByRole('checkbox', { name: /^楽曲/ })
    const timing = screen.getByRole('checkbox', { name: /^歌詞の時刻/ })

    await userEvent.click(music)
    expect(timing).not.toBeChecked()
    expect(timing).toBeDisabled()

    await userEvent.click(music)
    expect(timing).toBeEnabled()
    expect(timing).not.toBeChecked()
  })

  it('選んだ項目（決まった順）と名前を送り、知らせが無ければすぐ新しい作品を開く', async () => {
    const api = apiReturning()
    const { onOpen } = show(api)

    await userEvent.click(screen.getByRole('checkbox', { name: /^キャラクター/ }))
    await userEvent.click(screen.getByRole('button', { name: '複製する' }))

    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith(COPIED)
    })
    expect(api.duplicateProject).toHaveBeenCalledWith(SOURCE.id, {
      name: '進め！戦子ちゃん！のコピー',
      items: DUPLICATION_ITEMS.filter((item) => item !== 'characters'),
    })
  })

  it('知らせがあれば先に見せ、「新しい作品を開く」で開く', async () => {
    const { onOpen } = show(apiReturning(['キャラクターを持っていかなかったので、Shot 12 件の登場人物を外しました']))

    await userEvent.click(screen.getByRole('button', { name: '複製する' }))

    expect(await screen.findByText('キャラクターを持っていかなかったので、Shot 12 件の登場人物を外しました')).toBeInTheDocument()
    expect(onOpen).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '新しい作品を開く' }))
    expect(onOpen).toHaveBeenCalledWith(COPIED)
  })

  it('失敗したら理由を出し、もう一度押せる', async () => {
    const api: ProjectDuplicateApi = { duplicateProject: vi.fn(() => Promise.reject(new Error('書けませんでした'))) }
    show(api)

    await userEvent.click(screen.getByRole('button', { name: '複製する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('複製できませんでした')
    expect(screen.getByRole('button', { name: '複製する' })).toBeEnabled()
  })
})
