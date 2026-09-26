import type { MediaAssetId, Shot, WorkspaceId } from '@ixa/domain'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StartFrameField } from '@/components/workbench/inspector/start-frame-field'
import type { ShotStartFrameApi } from '@/lib/shot-start-frame-api'
import { SHOT_ID } from './fixtures'
import { aWorkbenchShot } from './workbench-fixture'

/**
 * Shot の最初のフレーム（ADR-0025）。画像を付けると「画像から動画（ローカル・無料）」で
 * Take にできる。付いている画像を見せ、付け替え・外すができる。
 */

vi.mock('@/components/image-uploader', () => ({
  ImageUploader: ({ onUploaded, submitLabel }: { onUploaded: (id: MediaAssetId) => Promise<void>; submitLabel: string }) => (
    <button type="button" onClick={() => void onUploaded('asset-new' as MediaAssetId)}>
      {submitLabel}
    </button>
  ),
}))
vi.mock('@/components/media-image', () => ({
  MediaImage: ({ mediaAssetId, alt }: { mediaAssetId: string; alt: string }) => <img alt={alt} data-asset={mediaAssetId} />,
}))

const api = (current: string | null): ShotStartFrameApi => ({
  getStartFrame: vi.fn(() => Promise.resolve({ mediaAssetId: current as MediaAssetId | null })),
  setStartFrame: vi.fn((_shot, mediaAssetId: MediaAssetId) => Promise.resolve({ mediaAssetId })),
  clearStartFrame: vi.fn(() => Promise.resolve()),
})

const shot: Shot = aWorkbenchShot(1, { id: SHOT_ID })
const WORKSPACE = 'ws' as WorkspaceId

describe('StartFrameField', () => {
  it('付いていなければ、付けると何ができるかを言う', async () => {
    render(<StartFrameField shot={shot} workspaceId={WORKSPACE} api={api(null)} />)

    expect(await screen.findByText(/画像を付けると/)).toBeTruthy()
  })

  it('画像を選ぶと付き、サムネイルが出る', async () => {
    const fake = api(null)
    const onChange = vi.fn()
    render(<StartFrameField shot={shot} workspaceId={WORKSPACE} api={fake} onChange={onChange} />)

    await userEvent.click(await screen.findByRole('button', { name: '画像を付ける' }))

    expect(fake.setStartFrame).toHaveBeenCalledWith(SHOT_ID, 'asset-new')
    expect((await screen.findByAltText('最初のフレーム')).getAttribute('data-asset')).toBe('asset-new')
    expect(onChange).toHaveBeenLastCalledWith(true)
  })

  it('外すと消える', async () => {
    const fake = api('asset-old')
    const onChange = vi.fn()
    render(<StartFrameField shot={shot} workspaceId={WORKSPACE} api={fake} onChange={onChange} />)
    await screen.findByAltText('最初のフレーム')

    await userEvent.click(screen.getByRole('button', { name: '外す' }))

    expect(fake.clearStartFrame).toHaveBeenCalledWith(SHOT_ID)
    await waitFor(() => {
      expect(screen.queryByAltText('最初のフレーム')).toBeNull()
    })
    expect(onChange).toHaveBeenLastCalledWith(false)
  })
})
