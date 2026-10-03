import {
  Character,
  CharacterId,
  CharacterLook,
  CharacterLookId,
  ProjectId,
  WorkspaceId,
  newId,
} from '@ixa/domain'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShotCastSection } from '@/components/workbench/inspector/shot-cast-section'
import { PROJECT_ID } from './fixtures'
import { aWorkbenchShot, assetStoreValue, renderInWorkbench } from './workbench-fixture'

/**
 * Look の無いキャラクターを登場人物に入れる（制作者 2026-10-04「戦子がキャラクター資料と違う見た目で出て来る」）。
 *
 * 画像だけで登録したキャラクターは Look を持たず、Shot の登場人物に入れられなかった（Look は必須）。そのため戦子は
 * どの Shot にも入らず、最初のフレームが参照画像なしで作られた。入れるときに既定の Look「基本」を作ってから入れる。
 */

const api = vi.hoisted(() => ({
  listShotCast: vi.fn(),
  replaceShotCast: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => api,
}))

const senko = Character.parse({
  id: newId(CharacterId),
  workspaceId: newId(WorkspaceId),
  projectId: ProjectId.parse(PROJECT_ID),
  name: '戦子',
  displayName: '戦子',
  createdAt: new Date('2026-10-03T00:00:00.000Z'),
})

const base = CharacterLook.parse({
  id: newId(CharacterLookId),
  characterId: senko.id,
  key: 'BASE',
  name: '基本',
  era: null,
  isDefault: true,
  canonicalFrameAssetId: null,
})

beforeEach(() => {
  api.listShotCast.mockReset().mockResolvedValue([])
  api.replaceShotCast.mockReset().mockImplementation((_shotId: string, entries: unknown[]) => Promise.resolve(entries))
})

describe('ShotCastSection', () => {
  it('Look の無いキャラクターも、既定の Look を作ってから登場人物に入れる', async () => {
    const shot = aWorkbenchShot(1)
    const assets = assetStoreValue({
      characters: { state: 'ready', value: [senko] },
      looks: new Map([[senko.id, []]]),
    })
    const ensureDefaultLook = vi.fn(() => Promise.resolve(base))
    renderInWorkbench(<ShotCastSection shot={shot} version={0} />, {}, {
      ...assets,
      actions: { ...assets.actions, ensureDefaultLook },
    })

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: '登場人物を足す' }), senko.id)

    await waitFor(() => {
      expect(api.replaceShotCast).toHaveBeenCalledWith(shot.id, [
        expect.objectContaining({ characterId: senko.id, lookId: base.id }),
      ])
    })
    expect(ensureDefaultLook).toHaveBeenCalledWith(senko.id)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
