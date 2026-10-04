import { CharacterId, CharacterIdentityImage, ImageGenerationJobId } from '@ixa/domain'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CharacterSheetField } from '@/components/workbench/character-sheet-field'
import type { CharacterSheetApi, WireCharacterSheetState } from '@/lib/character-sheet-api'
import { identityImageJson } from './fixtures'

/**
 * キャラクターシートの区画（ADR-0035。制作者 2026-10-03「動画生成に役立つ形式のキャラクターシートを
 * 1 枚の画像から作れるといい」）。手本の画像が無ければ落とすよう言い、あれば作れる。作っている間・失敗を言う。
 */

const characterId = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')
const JOB_ID = ImageGenerationJobId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAZ')
const image = (role: CharacterIdentityImage['role'], isPrimary = true) =>
  CharacterIdentityImage.parse({ ...identityImageJson, characterId, role, isPrimary })

const api = (state: WireCharacterSheetState = { job: null }) => {
  const getCharacterSheet = vi.fn<CharacterSheetApi['getCharacterSheet']>().mockResolvedValue(state)
  const startCharacterSheet = vi.fn<CharacterSheetApi['startCharacterSheet']>().mockResolvedValue({ jobId: JOB_ID })
  return { getCharacterSheet, startCharacterSheet }
}

describe('CharacterSheetField', () => {
  it('手本の画像があれば作れる。押すと頼んで「作っています」を出す', async () => {
    const client = api()
    render(<CharacterSheetField characterId={characterId} images={[image('full_body')]} version={0} onSheetAdded={vi.fn()} api={client} />)

    fireEvent.click(await screen.findByRole('button', { name: 'キャラクターシートを作る' }))

    await waitFor(() => {
      expect(client.startCharacterSheet).toHaveBeenCalledWith(characterId)
    })
    expect(await screen.findByText(/キャラクターシートを作っています/)).toBeTruthy()
  })

  it('手本の画像が無い（キャラクターシートしか無い）なら、正面などの画像を落とすよう言う', async () => {
    render(<CharacterSheetField characterId={characterId} images={[image('four_view')]} version={0} onSheetAdded={vi.fn()} api={api()} />)

    expect(await screen.findByText(/正面などの画像をここへ落とす/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /キャラクターシートを/ })).toBeNull()
  })

  it('もうシートがあれば「作り直す」。失敗した理由を出す', async () => {
    const failed = api({ job: { id: JOB_ID, status: 'failed', error: 'Codex CLI が絵を返しませんでした。' } })
    render(
      <CharacterSheetField
        characterId={characterId}
        images={[image('full_body'), image('four_view')]}
        version={0}
        onSheetAdded={vi.fn()}
        api={failed}
      />,
    )

    expect(await screen.findByRole('button', { name: 'キャラクターシートを作り直す' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/絵を返しませんでした/)
  })

  it('作っていたジョブができたら、識別画像を読み直させる', async () => {
    const client = api({ job: { id: JOB_ID, status: 'running', error: null } })
    const onSheetAdded = vi.fn()
    const { rerender } = render(
      <CharacterSheetField characterId={characterId} images={[image('full_body')]} version={0} onSheetAdded={onSheetAdded} api={client} />,
    )
    await screen.findByText(/キャラクターシートを作っています/)

    client.getCharacterSheet.mockResolvedValue({ job: { id: JOB_ID, status: 'succeeded', error: null } })
    rerender(<CharacterSheetField characterId={characterId} images={[image('full_body')]} version={1} onSheetAdded={onSheetAdded} api={client} />)

    await waitFor(() => {
      expect(onSheetAdded).toHaveBeenCalledTimes(1)
    })
  })
})
