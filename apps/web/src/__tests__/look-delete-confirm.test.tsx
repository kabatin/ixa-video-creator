import { CharacterLook, CharacterLookImage } from '@ixa/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LookDetail } from '@/components/look-detail'
import { LookImageGrid } from '@/components/look-image-grid'

/**
 * Look と Look 画像の削除は**取り消せない**。画面に戻す導線が無い。
 * 1 クリックで消えないことと、確認文に**どれが消えるか**が出ることを、実際に押して確かめる。
 *
 * 画像の取得は差し替える。ここで確かめたいのは削除の確認であって、署名付き URL の発行ではない。
 */
vi.mock('@/components/media-image', () => ({
  MediaImage: () => null,
}))

/** 26 文字の ULID を作る。ID は branded 型なので、実物と同じ形でないと schema を通らない。 */
const ulid = (suffix: string): string => {
  // ULID の文字集合は 0-9 と A-Z から I L O U を除いたもの。
  if (!/^[0-9A-HJKMNP-TV-Z]{1,21}$/.test(suffix)) throw new Error(`ULID に使えない: ${suffix}`)
  return `01HZY${'0'.repeat(21 - suffix.length)}${suffix}`
}

const look = CharacterLook.parse({
  id: ulid('KAAAA'),
  characterId: ulid('CHARA'),
  key: 'IXA_CUP_PAST',
  name: 'ステージ衣装',
  era: null,
  description: '',
  wardrobeTokens: [],
  styleTokens: [],
  colorPalette: [],
  isDefault: false,
  canonicalFrameAssetId: null,
})

const wardrobeImage = CharacterLookImage.parse({
  id: ulid('MGAAA'),
  lookId: look.id,
  mediaAssetId: ulid('ASSETA'),
  role: 'wardrobe',
  isPrimary: false,
  order: 0,
})

describe('Look の削除', () => {
  const setup = (overrides: Partial<typeof look> = {}) => {
    const onDelete = vi.fn()
    render(
      <LookDetail
        look={{ ...look, ...overrides }}
        busy={false}
        onMakeDefault={vi.fn()}
        onDelete={onDelete}
      />,
    )
    return { onDelete, user: userEvent.setup() }
  }

  it('1 回押しただけでは削除しない', async () => {
    const { onDelete, user } = setup()

    await user.click(screen.getByRole('button', { name: '削除（Look）' }))

    expect(onDelete).not.toHaveBeenCalled()
  })

  it('確認文に Look の名前と、戻せないことを出す', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: '削除（Look）' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('ステージ衣装')
    expect(dialog).toHaveTextContent('元に戻せません')
  })

  it('2 回目を押して初めて削除する', async () => {
    const { onDelete, user } = setup()

    await user.click(screen.getByRole('button', { name: '削除（Look）' }))
    await user.click(screen.getByRole('alertdialog').querySelector('button') as HTMLElement)

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('やめると削除しない', async () => {
    const { onDelete, user } = setup()

    await user.click(screen.getByRole('button', { name: '削除（Look）' }))
    await user.click(screen.getByRole('button', { name: 'やめる' }))

    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('既定の Look は削除できず、その理由を文字で出す', async () => {
    const { onDelete, user } = setup({ isDefault: true })

    await user.click(screen.getByRole('button', { name: '削除（Look）' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onDelete).not.toHaveBeenCalled()
    // ツールチップは触る端末とキーボードに出ない。理由は見える文字である必要がある。
    expect(screen.getByText('既定の Look は削除できません')).toBeInTheDocument()
  })
})

describe('Look 画像の削除', () => {
  const setup = (canonical: boolean) => {
    const onRemove = vi.fn()
    render(
      <LookImageGrid
        images={[wardrobeImage]}
        canonicalFrameAssetId={canonical ? wardrobeImage.mediaAssetId : null}
        busy={false}
        onPromote={vi.fn()}
        onRemove={onRemove}
      />,
    )
    return { onRemove, user: userEvent.setup() }
  }

  it('1 回押しただけでは削除しない', async () => {
    const { onRemove, user } = setup(false)

    await user.click(screen.getByRole('button', { name: '削除（衣装）' }))

    expect(onRemove).not.toHaveBeenCalled()
  })

  it('確認文に role と、戻せないことを出す', async () => {
    const { user } = setup(false)

    await user.click(screen.getByRole('button', { name: '削除（衣装）' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('衣装 の画像を削除します')
    expect(dialog).toHaveTextContent('元に戻せません')
  })

  it('canonical frame なら、それが消えることまで確認文に出す', async () => {
    const { user } = setup(true)

    await user.click(screen.getByRole('button', { name: '削除（衣装）' }))

    // 生成の基準が消えることは、role だけ見ても分からない。
    expect(screen.getByRole('alertdialog')).toHaveTextContent('canonical frame の画像（衣装）')
  })

  it('2 回目を押して初めて削除する', async () => {
    const { onRemove, user } = setup(false)

    await user.click(screen.getByRole('button', { name: '削除（衣装）' }))
    await user.click(screen.getByRole('alertdialog').querySelector('button') as HTMLElement)

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith(wardrobeImage.id)
  })
})
