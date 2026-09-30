import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AssetTree } from '@/components/workbench/asset-tree'
import { Location } from '@ixa/domain'
import { locationJson } from './fixtures'
import { assetStoreValue, renderInWorkbench } from './workbench-fixture'

const aLocation = Location.parse({ ...locationJson, createdAt: new Date(), updatedAt: new Date() })

/**
 * 素材ツリー（UI-WORKBENCH-2 §4.1）。実物が並び、＋ でその場に作れて、作った物を選ぶ。
 * 素材の共有状態はモックで差し替える（ツリーは `useAssets()` だけを見る）。
 */

const createLocation = vi.fn().mockResolvedValue({ id: '01ARZ3NDEKTSV4RRFFQ69G5FD0', name: '体育館' })

const renderTree = (ui: ReactNode = <AssetTree />) =>
  renderInWorkbench(<>{ui}</>, {}, {
    brandAssets: { state: 'error', message: 'ブランド資産を読み込めませんでした: 500' },
    tracks: { state: 'loading' },
    actions: { ...assetStoreValue().actions, createLocation },
  })

describe('AssetTree', () => {
  it('＋ で名前を入れて Enter すると作り、作った物を選ぶ', async () => {
    const { value } = renderTree()
    fireEvent.click(screen.getByRole('button', { name: 'ロケーションを追加' }))
    const input = screen.getByLabelText('ロケーションを追加（名前）')
    fireEvent.change(input, { target: { value: '体育館' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(createLocation).toHaveBeenCalledWith('体育館')
      expect(value.inspect).toHaveBeenCalledWith({ kind: 'location', id: '01ARZ3NDEKTSV4RRFFQ69G5FD0' })
    })
  })

  it('読めなかった一覧は「0 件」と言わず理由を出す（L-015）', () => {
    renderTree()
    expect(screen.getByRole('alert')).toHaveTextContent('ブランド資産を読み込めませんでした')
    expect(screen.getByText('!')).toBeInTheDocument()
  })

  it('読み込み中の件数は … で、0 と言わない', () => {
    renderTree()
    const header = screen.getByRole('button', { name: '楽曲…' })
    expect(header).toHaveTextContent('…')
    expect(header).not.toHaveTextContent('(0)')
  })

  /** 素材の上で右クリック（長押し）すると、その素材のメニュー（2026-09-30）。 */
  it('行を右クリックすると、その素材のメニューが開く', async () => {
    renderInWorkbench(<AssetTree />, {}, {
      locations: { state: 'ready', value: [{ ...aLocation, name: '体育館' }] },
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: /体育館/ }))

    expect(await screen.findByRole('menu', { name: '体育館 の操作' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'ロケーションを削除' })).toBeInTheDocument()
  })
})

