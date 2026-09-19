import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AssetTree } from '@/components/workbench/asset-tree'
import type { AssetStoreValue } from '@/components/workbench/asset-store'
import { renderInWorkbench } from './workbench-fixture'

/**
 * 素材ツリー（UI-WORKBENCH-2 §4.1）。実物が並び、＋ でその場に作れて、作った物を選ぶ。
 * 素材の共有状態はモックで差し替える（ツリーは `useAssets()` だけを見る）。
 */

const store = (patch: Partial<AssetStoreValue> = {}): AssetStoreValue => ({
  characters: { state: 'ready', value: [] },
  looks: new Map(),
  locations: { state: 'ready', value: [] },
  brandAssets: { state: 'error', message: 'ブランド資産を読み込めませんでした: 500' },
  tracks: { state: 'loading' },
  actions: {
    createCharacter: vi.fn(),
    updateCharacter: vi.fn(),
    deleteCharacter: vi.fn(),
    createLook: vi.fn(),
    updateLook: vi.fn(),
    deleteLook: vi.fn(),
    createLocation: vi.fn().mockResolvedValue({ id: '01ARZ3NDEKTSV4RRFFQ69G5FD0', name: '体育館' }),
    updateLocation: vi.fn(),
    deleteLocation: vi.fn(),
    createBrandAsset: vi.fn(),
    updateBrandAsset: vi.fn(),
    deleteBrandAsset: vi.fn(),
    addTrackFromFile: vi.fn(),
    updateTrack: vi.fn(),
    setMasterTrack: vi.fn(),
    deleteTrack: vi.fn(),
    analyzeTrack: vi.fn(),
  },
  ...patch,
})

let current = store()
vi.mock('@/components/workbench/asset-store', () => ({
  useAssets: () => current,
  readyOr: <T,>(loaded: { state: string; value?: readonly T[] }) => (loaded.state === 'ready' ? loaded.value : []),
}))

const renderTree = (ui: ReactNode = <AssetTree />) => renderInWorkbench(<>{ui}</>)

describe('AssetTree', () => {
  it('＋ で名前を入れて Enter すると作り、作った物を選ぶ', async () => {
    current = store()
    const { value } = renderTree()
    fireEvent.click(screen.getByRole('button', { name: 'ロケーションを追加' }))
    const input = screen.getByLabelText('ロケーションを追加（名前）')
    fireEvent.change(input, { target: { value: '体育館' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(current.actions.createLocation).toHaveBeenCalledWith('体育館')
      expect(value.inspect).toHaveBeenCalledWith({ kind: 'location', id: '01ARZ3NDEKTSV4RRFFQ69G5FD0' })
    })
  })

  it('読めなかった一覧は「0 件」と言わず理由を出す（L-015）', () => {
    current = store()
    renderTree()
    expect(screen.getByRole('alert')).toHaveTextContent('ブランド資産を読み込めませんでした')
    expect(screen.getByText('!')).toBeInTheDocument()
  })

  it('読み込み中の件数は … で、0 と言わない', () => {
    current = store()
    renderTree()
    const header = screen.getByRole('button', { name: '楽曲…' })
    expect(header).toHaveTextContent('…')
    expect(header).not.toHaveTextContent('(0)')
  })
})
