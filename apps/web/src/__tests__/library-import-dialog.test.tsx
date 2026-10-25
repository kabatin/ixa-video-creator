import { BrandAsset, Character, Location, MediaAssetId, MusicTrack, Project, ProjectId, newId } from '@ixa/domain'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LibraryImportDialogBody, type LibraryImportSourceApi } from '@/components/workbench/dialogs/library-import-dialog'
import { WireVoice } from '@/lib/narration-api'
import type { WireSfxJob } from '@/lib/sfx-job-api'
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
  speakerNo: 1,
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

const senko = WireVoice.parse({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FZ6',
  projectId: luna.id,
  name: '戦子',
  tool: 'gemini_api',
  model: 'gemini-3.8-flash-tts',
  voiceName: 'Kore',
  styleNote: '',
  speed: 1,
  volume: 1,
  language: 'ja',
  tuning: {},
  textStyleId: null,
  characterId: null,
  createdAt: '2026-10-19T00:00:00Z',
  updatedAt: '2026-10-19T00:00:00Z',
})
const song = MusicTrack.parse({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FZ7',
  projectId: luna.id,
  mediaAssetId: newId(MediaAssetId),
  title: 'LUNA のテーマ',
  isMaster: true,
})
const clash = [newId(MediaAssetId), newId(MediaAssetId)] as const
const clashJob: WireSfxJob = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FZ8',
  status: 'succeeded',
  cue: { startSec: 3.75, durationSec: 1.5, prompt: 'sword clash', volume: 0.8 },
  mediaAssetIds: [...clash],
  timelineClipId: null,
}

const sourceApi = (): LibraryImportSourceApi => ({
  // 一覧には開いているプロジェクト自身も入る（取り込み元には出さない）。
  listProjects: vi.fn(() => Promise.resolve([aProject, luna, ixa])),
  listCharacters: vi.fn((projectId) => Promise.resolve(projectId === luna.id ? [mina] : [])),
  listLocations: vi.fn((projectId) => Promise.resolve(projectId === luna.id ? [storefront] : [])),
  listBrandAssets: vi.fn((projectId) => Promise.resolve(projectId === luna.id ? [amber] : [])),
  listVoices: vi.fn((projectId) => Promise.resolve(projectId === luna.id ? [senko] : [])),
  listMusicTracks: vi.fn((projectId) => Promise.resolve(projectId === luna.id ? [song] : [])),
  listSfxJobs: vi.fn((projectId) => Promise.resolve(projectId === luna.id ? [clashJob] : [])),
})

const openTab = (name: RegExp): void => {
  fireEvent.click(screen.getByRole('tab', { name }))
}

const NOTHING = { characterIds: [], locationIds: [], brandAssetIds: [], voiceIds: [], musicTrackIds: [], sfxSounds: [] }

describe('LibraryImportDialogBody', () => {
  it('ほかのプロジェクトを選ぶと、その素材が並ぶ（開いているプロジェクトは元に出さない）', async () => {
    renderInWorkbench(<LibraryImportDialogBody api={sourceApi()} />)

    const source = await screen.findByLabelText('取り込み元のプロジェクト')
    expect([...(source as HTMLSelectElement).options].map((option) => option.textContent)).toEqual([
      'LUNA BREW 30秒CM',
      'iXA CUP MUSIC VIDEO',
    ])
    expect(await screen.findByLabelText('ミナ')).toBeTruthy()
    openTab(/^ロケーション/)
    expect(screen.getByLabelText('雨の夜の店先')).toBeTruthy()
    openTab(/^ブランド資産/)
    expect(screen.getByLabelText('LUNA アンバー')).toBeTruthy()
  })

  it('チェックした分だけを取り込み、知らせて閉じる', async () => {
    const importLibrary = vi.fn(() => Promise.resolve({ characters: [mina], locations: [], brandAssets: [amber], voices: [], musicTracks: [], sfxSounds: [] }))
    const { value } = renderInWorkbench(
      <LibraryImportDialogBody api={sourceApi()} />,
      {},
      assetStoreValue({ actions: { ...assetStoreValue().actions, importLibrary } }),
    )

    fireEvent.click(await screen.findByLabelText('ミナ'))
    openTab(/^ブランド資産/)
    fireEvent.click(screen.getByLabelText('LUNA アンバー'))
    fireEvent.click(screen.getByRole('button', { name: '2 件を取り込む' }))

    await waitFor(() => {
      expect(importLibrary).toHaveBeenCalledWith({ ...NOTHING, characterIds: [mina.id], brandAssetIds: [amber.id] })
    })
    await waitFor(() => {
      expect(value.notify).toHaveBeenCalledWith(expect.stringMatching(/2 件を取り込みました/))
    })
    expect(value.closeDialog).toHaveBeenCalled()
  })

  it('声・楽曲・効果音も区分を替えて選べ、区分をまたいでまとめて取り込む（制作者 2026-10-19）', async () => {
    const importLibrary = vi.fn(() =>
      Promise.resolve({ characters: [], locations: [], brandAssets: [], voices: [senko], musicTracks: [song], sfxSounds: [] }),
    )
    const { value } = renderInWorkbench(
      <LibraryImportDialogBody api={sourceApi()} />,
      {},
      assetStoreValue({ actions: { ...assetStoreValue().actions, importLibrary } }),
    )

    await screen.findByLabelText('ミナ')
    openTab(/^声/)
    fireEvent.click(screen.getByLabelText(/戦子/))
    openTab(/^楽曲/)
    fireEvent.click(screen.getByLabelText(/LUNA のテーマ/))
    openTab(/^効果音/)
    // 1 回に 2 本作った音は 1 本ずつ選べる（素材ツリーと同じ名前）。
    fireEvent.click(screen.getByLabelText('sword clash（候補 2）'))
    fireEvent.click(screen.getByRole('button', { name: '3 件を取り込む' }))

    await waitFor(() => {
      expect(importLibrary).toHaveBeenCalledWith({
        ...NOTHING,
        voiceIds: [senko.id],
        musicTrackIds: [song.id],
        sfxSounds: [{ sfxJobId: clashJob.id, mediaAssetId: clash[1] }],
      })
    })
    // 効果音の一覧は素材の共有状態の外にあるので、取り直しの合図を出す。
    await waitFor(() => {
      expect(value.bumpSfx).toHaveBeenCalled()
    })
  })

  it('素材ツリーの段から開くと、その段の区分から始まる', async () => {
    renderInWorkbench(<LibraryImportDialogBody api={sourceApi()} />, { dialogImportSection: 'voices' })

    expect(await screen.findByLabelText(/戦子/)).toBeTruthy()
    expect(screen.getByRole('tab', { name: /^声/ }).getAttribute('aria-selected')).toBe('true')
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
