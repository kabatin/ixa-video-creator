import { Character, CharacterId, CharacterLook } from '@ixa/domain'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useAssetMenu, type AssetTarget } from '@/components/workbench/use-asset-menu'
import { characterJson, lookJson } from './fixtures'
import { assetStoreValue, renderInWorkbench } from './workbench-fixture'

/**
 * 素材の右クリックのメニュー（素材ツリー）。右クリックした素材を選び、その素材に対して動く。
 * 削除は確認を挟み、インスペクターの「…」と同じ文で何が起きるかを言う。
 */

const character = Character.parse({
  ...characterJson,
  createdAt: new Date(characterJson.createdAt),
})
const look = CharacterLook.parse({
  ...lookJson,
  isDefault: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})

const Opener = ({ target }: { readonly target: AssetTarget }) => {
  const menu = useAssetMenu()
  return (
    <button
      type="button"
      onClick={(event) => {
        menu.open(target, { x: 1, y: 1 }, event.currentTarget)
      }}
    >
      開く
    </button>
  )
}

const setup = async (target: AssetTarget) => {
  const actions = assetStoreValue().actions
  const rendered = renderInWorkbench(
    <Opener target={target} />,
    {},
    {
      characters: { state: 'ready', value: [character] },
      looks: new Map([[character.id, [look]]]),
      actions,
    },
  )
  await userEvent.click(screen.getByRole('button', { name: '開く' }))
  return { ...rendered, actions }
}

describe('useAssetMenu', () => {
  it('開くと、その素材を選ぶ', async () => {
    const { value } = await setup({ kind: 'character', id: character.id })

    expect(value.inspect).toHaveBeenCalledWith({ kind: 'character', id: character.id })
    expect(
      screen.getByRole('menu', { name: `${character.displayName} の操作` }),
    ).toBeInTheDocument()
  })

  it('素材ビューアで見る で、素材ビューアを前に出す', async () => {
    const { value } = await setup({ kind: 'character', id: character.id })

    await userEvent.click(screen.getByRole('menuitem', { name: '素材ビューアで見る' }))

    expect(value.openViewer).toHaveBeenCalled()
  })

  it('削除は確認のあとで消し、選択を外す', async () => {
    const { value, actions } = await setup({ kind: 'character', id: character.id })

    await userEvent.click(screen.getByRole('menuitem', { name: 'キャラクターを削除' }))
    expect(actions.deleteCharacter).not.toHaveBeenCalled()
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'キャラクターを削除' }),
    )

    await waitFor(() => {
      expect(actions.deleteCharacter).toHaveBeenCalledWith(character.id)
      expect(value.inspect).toHaveBeenLastCalledWith(null)
    })
  })

  it('Look を既定にする', async () => {
    const { actions } = await setup({
      kind: 'look',
      id: look.id,
      characterId: CharacterId.parse(character.id),
    })

    await userEvent.click(screen.getByRole('menuitem', { name: '既定の Look にする' }))

    await waitFor(() => {
      expect(actions.updateLook).toHaveBeenCalledWith(look.id, { isDefault: true })
    })
  })

  it('見つからない素材ではメニューを開かない', async () => {
    renderInWorkbench(
      <Opener target={{ kind: 'location', id: '01ARZ3NDEKTSV4RRFFQ69G5FZZ' as never }} />,
    )
    await userEvent.click(screen.getByRole('button', { name: '開く' }))

    expect(screen.queryByRole('menu')).toBeNull()
  })
})
