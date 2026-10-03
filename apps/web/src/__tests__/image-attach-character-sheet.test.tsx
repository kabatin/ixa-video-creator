import { Character, CharacterId, MediaAssetId } from '@ixa/domain'
import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetStoreContext } from '@/components/workbench/asset-store'
import { useImageAttach } from '@/components/workbench/use-image-attach'
import { WorkbenchContext } from '@/components/workbench/workbench-context'
import { aProject, assetStoreValue, workbenchValue } from './workbench-fixture'

/**
 * 画像を落として「新しいキャラクターにする（キャラクターシートも作る）」を選んだとき（ADR-0035）。
 * キャラクターを作る → 画像を識別画像に入れる → その画像を手本にシートを作り始める、の順。
 * 「新しいキャラクターにする」はシートを作らない（画像を入れるところまで）。
 */

const fake = vi.hoisted(() => ({
  uploadMedia: vi.fn(),
  addIdentityImage: vi.fn(),
  listIdentityImages: vi.fn(),
  startCharacterSheet: vi.fn(),
}))
vi.mock('@/lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...original, createApiClient: () => fake }
})

const character = Character.parse({
  id: CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  workspaceId: aProject.workspaceId,
  projectId: aProject.id,
  name: 'takepi',
  displayName: 'takepi',
  createdAt: new Date(),
})

const attachInto = async (kind: 'new-character' | 'new-character-sheet') => {
  const order: string[] = []
  const createCharacter = vi.fn(() => (order.push('create'), Promise.resolve(character)))
  fake.uploadMedia.mockResolvedValue({ id: MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW') })
  fake.addIdentityImage.mockImplementation(() => (order.push('image'), Promise.resolve({})))
  fake.startCharacterSheet.mockImplementation(() => (order.push('sheet'), Promise.resolve({ jobId: 'x' })))
  let result: unknown = null
  const Probe = () => {
    const attach = useImageAttach()
    useEffect(() => {
      void attach({ kind }, [new File(['x'], 'takepi.png', { type: 'image/png' })]).then((r) => {
        result = r
      })
    }, [attach])
    return null
  }

  await act(async () => {
    render(
      <AssetStoreContext.Provider value={assetStoreValue({ actions: { ...assetStoreValue().actions, createCharacter } })}>
        <WorkbenchContext.Provider value={workbenchValue()}>
          <Probe />
        </WorkbenchContext.Provider>
      </AssetStoreContext.Provider>,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return { order, createCharacter, result }
}

describe('新しいキャラクターにしてシートを作る', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ファイル名でキャラクターを作り、画像を主の識別画像に入れ、シートを作り始める', async () => {
    const { order, createCharacter, result } = await attachInto('new-character-sheet')

    expect(createCharacter).toHaveBeenCalledWith('takepi')
    expect(fake.addIdentityImage).toHaveBeenCalledWith(character.id, expect.objectContaining({ role: 'full_body', isPrimary: true, order: 0 }))
    expect(fake.startCharacterSheet).toHaveBeenCalledWith(character.id)
    expect(order).toEqual(['create', 'image', 'sheet'])
    expect(result).toEqual({ kind: 'character', id: character.id })
  })

  /** 制作者 2026-10-03「キャラクターシートを作成せずにキャラクター画像を入れる選択肢がない」。 */
  it('シートを作らない選択なら、キャラクターを作って画像を入れるだけ（AI は呼ばない）', async () => {
    const { order, createCharacter, result } = await attachInto('new-character')

    expect(createCharacter).toHaveBeenCalledWith('takepi')
    expect(fake.addIdentityImage).toHaveBeenCalledWith(character.id, expect.objectContaining({ role: 'full_body', isPrimary: true, order: 0 }))
    expect(fake.startCharacterSheet).not.toHaveBeenCalled()
    expect(order).toEqual(['create', 'image'])
    expect(result).toEqual({ kind: 'character', id: character.id })
  })
})
