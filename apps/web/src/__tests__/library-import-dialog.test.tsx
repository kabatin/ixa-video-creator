import { BrandAsset, Character, Location, Project, ProjectId } from '@ixa/domain'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LibraryImportDialogBody, type LibraryImportSourceApi } from '@/components/workbench/dialogs/library-import-dialog'
import { aProject, assetStoreValue, renderInWorkbench } from './workbench-fixture'

/**
 * ほかのプロジェクトから取り込む（ADR-0034。制作者 2026-10-03「全プロジェクトで共有になっている。プロジェクト単位に
 * しないと大変なことになる」）。取り込み元のプロジェクトを選び、チェックした分を複製して、このプロジェクトに足す。
 */

const luna = Project.parse({ ...aProject, id: ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FZ1'), name: 'LUNA BREW 30秒CM' })
const ixa = Project.parse({ ...aProject, id: ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FZ2'), name: 'iXA CUP MUSIC VIDEO' })

const mina = Character.parse({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FZ3',
  workspaceId: luna.workspaceId,
  projectId: luna.id,
  name: 'mina',
  displayName: 'ミナ',
  createdAt: new Date('2026-09-26T00:00:00Z'),
})
const storefront = Location.parse({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FZ4',
  workspaceId: luna.workspaceId,
  projectId: luna.id,
  name: '雨の夜の店先',
})
const amber = BrandAsset.parse({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FZ5',
  workspaceId: luna.workspaceId,
  projectId: luna.id,
  category: 'color',
  name: 'LUNA アンバー',
  mediaAssetId: null,
  value: '#C8873A',
})

const sourceApi = (): LibraryImportSourceApi => ({
  // 一覧には開いているプロジェクト自身も入る（取り込み元には出さない）。
  listProjects: vi.fn(() => Promise.resolve([aProject, luna, ixa])),
  listCharacters: vi.fn((projectId) => Promise.resolve(projectId === luna.id ? [mina] : [])),
  listLocations: vi.fn((projectId) => Promise.resolve(projectId === luna.id ? [storefront] : [])),
  listBrandAssets: vi.fn((projectId) => Promise.resolve(projectId === luna.id ? [amber] : [])),
})

describe('LibraryImportDialogBody', () => {
  it('ほかのプロジェクトを選ぶと、その素材が並ぶ（開いているプロジェクトは元に出さない）', async () => {
    renderInWorkbench(<LibraryImportDialogBody api={sourceApi()} />)

    const source = await screen.findByLabelText('取り込み元のプロジェクト')
    expect([...(source as HTMLSelectElement).options].map((option) => option.textContent)).toEqual([
      'LUNA BREW 30秒CM',
      'iXA CUP MUSIC VIDEO',
    ])
    expect(await screen.findByLabelText('ミナ')).toBeTruthy()
    expect(screen.getByLabelText('雨の夜の店先')).toBeTruthy()
    expect(screen.getByLabelText('LUNA アンバー')).toBeTruthy()
  })

  it('チェックした分だけを取り込み、知らせて閉じる', async () => {
    const importLibrary = vi.fn(() => Promise.resolve({ characters: [mina], locations: [], brandAssets: [amber] }))
    const { value } = renderInWorkbench(
      <LibraryImportDialogBody api={sourceApi()} />,
      {},
      assetStoreValue({ actions: { ...assetStoreValue().actions, importLibrary } }),
    )

    fireEvent.click(await screen.findByLabelText('ミナ'))
    fireEvent.click(screen.getByLabelText('LUNA アンバー'))
    fireEvent.click(screen.getByRole('button', { name: '2 件を取り込む' }))

    await waitFor(() => {
      expect(importLibrary).toHaveBeenCalledWith({
        characterIds: [mina.id],
        locationIds: [],
        brandAssetIds: [amber.id],
      })
    })
    await waitFor(() => {
      expect(value.notify).toHaveBeenCalledWith(expect.stringMatching(/2 件を取り込みました/))
    })
    expect(value.closeDialog).toHaveBeenCalled()
  })

  it('何もチェックしていなければ押せない', async () => {
    renderInWorkbench(<LibraryImportDialogBody api={sourceApi()} />)

    await screen.findByLabelText('ミナ')
    expect(screen.getByRole('button', { name: '取り込む' })).toBeDisabled()
  })

  it('ほかにプロジェクトが無ければ、そう言う', async () => {
    const api = { ...sourceApi(), listProjects: vi.fn(() => Promise.resolve([aProject])) }
    renderInWorkbench(<LibraryImportDialogBody api={api} />)

    expect(await screen.findByText(/取り込めるほかのプロジェクトがありません/)).toBeTruthy()
  })
})
