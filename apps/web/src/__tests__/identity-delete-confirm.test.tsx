import { CharacterIdentityImage } from '@ixa/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { IdentityImageGrid } from '@/components/identity-image-grid'

/**
 * 識別画像の削除は**取り消せない**。
 * 主画像を消すと、その role の参照が無くなる。確認文でそこまで伝わることを確かめる。
 */
vi.mock('@/components/media-image', () => ({
  MediaImage: () => null,
}))

const ulid = (suffix: string): string => {
  // ULID の文字集合は 0-9 と A-Z から I L O U を除いたもの。
  if (!/^[0-9A-HJKMNP-TV-Z]{1,21}$/.test(suffix)) throw new Error(`ULID に使えない: ${suffix}`)
  return `01HZY${'0'.repeat(21 - suffix.length)}${suffix}`
}

const fourView = CharacterIdentityImage.parse({
  id: ulid('DAAAA'),
  characterId: ulid('CHARA'),
  mediaAssetId: ulid('ASSETA'),
  role: 'four_view',
  isPrimary: true,
  order: 0,
})

const faceFront = CharacterIdentityImage.parse({
  id: ulid('DBBBB'),
  characterId: ulid('CHARA'),
  mediaAssetId: ulid('ASSETB'),
  role: 'face_front',
  isPrimary: false,
  order: 1,
})

describe('識別画像の削除', () => {
  const setup = () => {
    const onRemove = vi.fn()
    render(
      <IdentityImageGrid
        images={[fourView, faceFront]}
        busy={false}
        onSetPrimary={vi.fn()}
        onRemove={onRemove}
      />,
    )
    return { onRemove, user: userEvent.setup() }
  }

  it('1 回押しただけでは削除しない', async () => {
    const { onRemove, user } = setup()

    await user.click(screen.getByRole('button', { name: '削除（四面図）' }))

    expect(onRemove).not.toHaveBeenCalled()
  })

  it('主画像なら、確認文で主画像だと分かる', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: '削除（四面図）' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('四面図 の主画像を削除します')
    expect(dialog).toHaveTextContent('元に戻せません')
  })

  it('主画像でないものは、主画像だと書かない', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: '削除（顔（正面））' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('顔（正面） の画像を削除します')
    expect(dialog).not.toHaveTextContent('主画像')
  })

  it('2 回目を押して初めて削除する。押した行のものだけを消す', async () => {
    const { onRemove, user } = setup()

    await user.click(screen.getByRole('button', { name: '削除（顔（正面））' }))
    await user.click(screen.getByRole('alertdialog').querySelector('button') as HTMLElement)

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith(faceFront.id)
  })

  it('やめると削除しない', async () => {
    const { onRemove, user } = setup()

    await user.click(screen.getByRole('button', { name: '削除（四面図）' }))
    await user.click(screen.getByRole('button', { name: 'やめる' }))

    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
