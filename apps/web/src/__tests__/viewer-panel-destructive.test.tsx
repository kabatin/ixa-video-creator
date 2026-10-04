import { CharacterId, CharacterLookId, Location } from '@ixa/domain'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ViewerPanel } from '@/components/workbench/panels/viewer-panel'
import { ApiError } from '@/lib/api-error'
import { PROJECT_ID, WORKSPACE_ID } from './fixtures'
import { assetStoreValue, renderInWorkbench } from './workbench-fixture'

/**
 * 素材ビューアの「消す」操作（S3）。
 *
 * 旧画面（`identity-image-grid` / `look-image-grid`）は `ConfirmButton` で確認してから消す。
 * **新しいビューアの方が危ない**という状態を許さないための検査。
 *
 * 見るのは 3 つ。
 * 1. 1 回押しただけでは API を呼ばない（確認が要る）
 * 2. 確認すると API を呼ぶ
 * 3. 失敗したら黙らず、**URL もレスポンス本文も出さずに**読める文を出す
 *    （`describeError` を使うと両方が画面に出る。`describeForPerson` を通すこと）
 */

vi.mock('@/components/media-image', () => ({ MediaImage: () => null }))

const api = vi.hoisted(() => ({
  listIdentityImages: vi.fn(),
  listLookImages: vi.fn(),
  removeIdentityImage: vi.fn(),
  removeLookImage: vi.fn(),
  setPrimaryIdentityImage: vi.fn(),
  uploadMedia: vi.fn(),
  // キャラクターシートの区画（ADR-0035）が状態を読む。ここでは作らない。
  getCharacterSheet: vi.fn(() => Promise.resolve({ job: null })),
  startCharacterSheet: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({ createApiClient: () => api }))

const CHARACTER_ID = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC0')
const LOOK_ID = CharacterLookId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC1')
const LOCATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC2'
const IDENTITY_IMAGE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC3'
const LOOK_IMAGE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC4'
const ASSET_A = '01ARZ3NDEKTSV4RRFFQ69G5FC5'
const ASSET_B = '01ARZ3NDEKTSV4RRFFQ69G5FC6'

const faceFront = {
  id: IDENTITY_IMAGE_ID,
  characterId: CHARACTER_ID,
  mediaAssetId: ASSET_A,
  role: 'face_front',
  isPrimary: false,
  order: 1,
}

const wardrobe = {
  id: LOOK_IMAGE_ID,
  lookId: LOOK_ID,
  mediaAssetId: ASSET_B,
  role: 'wardrobe',
  isPrimary: false,
  order: 0,
}

const aLocation = Location.parse({
  id: LOCATION_ID,
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  name: '体育館',
  description: '',
  referenceAssetIds: [ASSET_A, ASSET_B],
})

/**
 * 実際に API が返すものに近い失敗。
 * `message` には URL が、`body` にはサーバ内部の事情が入っている。**どちらも画面に出さない。**
 */
const SERVER_BODY =
  '{"success":false,"error":"この画像は他の Shot で使われています","trace":"pg ECONNREFUSED 10.0.0.3:5432"}'

const anApiFailure = (): ApiError =>
  new ApiError(
    `DELETE http://localhost:3001/identity-images/${IDENTITY_IMAGE_ID}: API が 500 を返しました — ${SERVER_BODY}`,
    500,
    SERVER_BODY,
  )

/** 画面に出た文が、人に読めて、かつ機械の事情を漏らしていないこと。 */
const expectReadableWithoutLeak = (element: HTMLElement): void => {
  const text = element.textContent ?? ''
  expect(text).toContain('この画像は他の Shot で使われています')
  expect(text).not.toContain('http')
  expect(text).not.toContain('ECONNREFUSED')
  expect(text).not.toContain('"success"')
  expect(text).not.toContain('trace')
}

const renderCharacter = () =>
  renderInWorkbench(<ViewerPanel />, { inspected: { kind: 'character', id: CHARACTER_ID } })

const renderLook = () =>
  renderInWorkbench(<ViewerPanel />, {
    inspected: { kind: 'look', id: LOOK_ID, characterId: CHARACTER_ID },
  })

const renderLocation = (updateLocation: ReturnType<typeof vi.fn>) =>
  renderInWorkbench(
    <ViewerPanel />,
    { inspected: { kind: 'location', id: aLocation.id } },
    {
      locations: { state: 'ready', value: [aLocation] },
      actions: { ...assetStoreValue().actions, updateLocation },
    },
  )

beforeEach(() => {
  vi.clearAllMocks()
  api.listIdentityImages.mockResolvedValue([faceFront])
  api.listLookImages.mockResolvedValue([wardrobe])
  api.removeIdentityImage.mockResolvedValue(undefined)
  api.removeLookImage.mockResolvedValue(undefined)
  api.setPrimaryIdentityImage.mockResolvedValue(faceFront)
})

describe('識別画像を消す', () => {
  it('1 回押しただけでは削除しない。確認を出す', async () => {
    const user = userEvent.setup()
    renderCharacter()

    await user.click(await screen.findByRole('button', { name: '削除（顔（正面））' }))

    expect(api.removeIdentityImage).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('顔（正面） の画像を削除します')
    expect(dialog).toHaveTextContent('元に戻せません')
  })

  it('確認して初めて削除する', async () => {
    const user = userEvent.setup()
    renderCharacter()

    await user.click(await screen.findByRole('button', { name: '削除（顔（正面））' }))
    await user.click(screen.getByRole('alertdialog').querySelector('button') as HTMLElement)

    await waitFor(() => {
      expect(api.removeIdentityImage).toHaveBeenCalledWith(IDENTITY_IMAGE_ID)
    })
    expect(api.removeIdentityImage).toHaveBeenCalledTimes(1)
  })

  it('やめると削除しない', async () => {
    const user = userEvent.setup()
    renderCharacter()

    await user.click(await screen.findByRole('button', { name: '削除（顔（正面））' }))
    await user.click(screen.getByRole('button', { name: 'やめる' }))

    expect(api.removeIdentityImage).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('失敗したら読める文を出す。URL もレスポンス本文も出さない', async () => {
    api.removeIdentityImage.mockRejectedValue(anApiFailure())
    const user = userEvent.setup()
    renderCharacter()

    await user.click(await screen.findByRole('button', { name: '削除（顔（正面））' }))
    await user.click(screen.getByRole('alertdialog').querySelector('button') as HTMLElement)

    const alert = await screen.findByRole('alert')
    expectReadableWithoutLeak(alert)
  })

  it('失敗したら一覧から消さない。消えたように見せない', async () => {
    api.removeIdentityImage.mockRejectedValue(anApiFailure())
    const user = userEvent.setup()
    renderCharacter()

    await user.click(await screen.findByRole('button', { name: '削除（顔（正面））' }))
    await user.click(screen.getByRole('alertdialog').querySelector('button') as HTMLElement)
    await screen.findByRole('alert')

    expect(screen.getByRole('button', { name: '削除（顔（正面））' })).toBeInTheDocument()
  })
})

describe('Look 画像を消す', () => {
  it('1 回押しただけでは削除せず、確認して初めて削除する', async () => {
    const user = userEvent.setup()
    renderLook()

    await user.click(await screen.findByRole('button', { name: '削除（衣装）' }))
    expect(api.removeLookImage).not.toHaveBeenCalled()

    await user.click(screen.getByRole('alertdialog').querySelector('button') as HTMLElement)
    await waitFor(() => {
      expect(api.removeLookImage).toHaveBeenCalledWith(LOOK_IMAGE_ID)
    })
  })

  it('失敗したら読める文を出す。URL もレスポンス本文も出さない', async () => {
    api.removeLookImage.mockRejectedValue(anApiFailure())
    const user = userEvent.setup()
    renderLook()

    await user.click(await screen.findByRole('button', { name: '削除（衣装）' }))
    await user.click(screen.getByRole('alertdialog').querySelector('button') as HTMLElement)

    expectReadableWithoutLeak(await screen.findByRole('alert'))
  })
})

describe('ロケーションの参照画像を外す', () => {
  /**
   * ここだけは実体が「解除」。`referenceAssetIds` から 1 件抜くだけで、
   * MediaAsset も他のロケーションの参照も残る（`packages/domain/src/asset/library.ts`）。
   * だから「削除」「元に戻せません」とは言わない。
   */
  it('言葉は解除。削除とも元に戻せないとも言わない', async () => {
    const user = userEvent.setup()
    renderLocation(vi.fn().mockResolvedValue(aLocation))

    await user.click(screen.getByRole('button', { name: '解除（参照 1）' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('画像そのものは消えません')
    expect(dialog).not.toHaveTextContent('元に戻せません')
  })

  it('1 回押しただけでは外さず、確認して初めて外す。押した 1 枚だけ', async () => {
    const updateLocation = vi.fn().mockResolvedValue(aLocation)
    const user = userEvent.setup()
    renderLocation(updateLocation)

    await user.click(screen.getByRole('button', { name: '解除（参照 1）' }))
    expect(updateLocation).not.toHaveBeenCalled()

    await user.click(screen.getByRole('alertdialog').querySelector('button') as HTMLElement)
    await waitFor(() => {
      expect(updateLocation).toHaveBeenCalledWith(aLocation.id, { referenceAssetIds: [ASSET_B] })
    })
  })

  it('失敗したら読める文を出す。URL もレスポンス本文も出さない', async () => {
    const user = userEvent.setup()
    renderLocation(vi.fn().mockRejectedValue(anApiFailure()))

    await user.click(screen.getByRole('button', { name: '解除（参照 1）' }))
    await user.click(screen.getByRole('alertdialog').querySelector('button') as HTMLElement)

    expectReadableWithoutLeak(await screen.findByRole('alert'))
  })
})

describe('主画像にする', () => {
  it('失敗したら黙らない（破壊的ではないが、押した結果が分からないのは同じ）', async () => {
    api.setPrimaryIdentityImage.mockRejectedValue(anApiFailure())
    const user = userEvent.setup()
    renderCharacter()

    await user.click(await screen.findByRole('button', { name: '主にする' }))

    expectReadableWithoutLeak(await screen.findByRole('alert'))
  })
})
