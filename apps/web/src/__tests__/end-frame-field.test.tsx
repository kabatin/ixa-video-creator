import type { MediaAssetId, Shot, ShotId, WorkspaceId } from '@ixa/domain'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { END_FRAME_NOTE, EndFrameField, type EndFrameCandidate } from '@/components/workbench/inspector/end-frame-field'
import type { ShotEndFrameApi } from '@/lib/shot-end-frame-api'
import type { ShotStartFrameApi } from '@/lib/shot-start-frame-api'
import { SHOT_ID } from './fixtures'
import { aWorkbenchShot } from './workbench-fixture'

/**
 * Shot の終わりの画像。付けた画像が作る動画の最後のコマになる（ループの終わりに最初の Shot の絵を使う）。
 * 付いている画像を見せ、ほかの Shot の最初のフレームから付け・外せる。
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

const FIRST = aWorkbenchShot(1)
const shot: Shot = aWorkbenchShot(9, { id: SHOT_ID })
const WORKSPACE = 'ws' as WorkspaceId
const candidates: readonly EndFrameCandidate[] = [{ id: FIRST.id, code: FIRST.code }]

const api = (current: string | null) => ({
  getEndFrame: vi.fn<ShotEndFrameApi['getEndFrame']>(() =>
    Promise.resolve({ mediaAssetId: current as MediaAssetId | null }),
  ),
  setEndFrame: vi.fn<ShotEndFrameApi['setEndFrame']>((_shot, mediaAssetId) =>
    Promise.resolve({ mediaAssetId, timing: 'fit' as const }),
  ),
  clearEndFrame: vi.fn<ShotEndFrameApi['clearEndFrame']>(() => Promise.resolve()),
  getStartFrame: vi.fn<ShotStartFrameApi['getStartFrame']>((id: ShotId) =>
    Promise.resolve({ mediaAssetId: (id === FIRST.id ? 'asset-first' : null) as MediaAssetId | null, job: null }),
  ),
})

describe('EndFrameField', () => {
  it('付いていなければ、付けると何が起きるかと、尺に合わせる旨を言う', async () => {
    render(<EndFrameField shot={shot} workspaceId={WORKSPACE} candidates={candidates} api={api(null)} />)

    expect(await screen.findByText(/作る動画がこの絵で終わります/)).toBeTruthy()
    expect(screen.getByText(END_FRAME_NOTE)).toBeTruthy()
    expect(screen.queryByAltText('終わりの画像')).toBeNull()
  })

  it('付いていればサムネイルを出す', async () => {
    render(<EndFrameField shot={shot} workspaceId={WORKSPACE} candidates={candidates} api={api('asset-old')} />)

    expect((await screen.findByAltText('終わりの画像')).getAttribute('data-asset')).toBe('asset-old')
  })

  it('ほかの Shot の最初のフレームを選ぶと、その絵を終わりの画像にして読み直させる', async () => {
    const fake = api(null)
    const onSaved = vi.fn()
    render(<EndFrameField shot={shot} workspaceId={WORKSPACE} candidates={candidates} api={fake} onSaved={onSaved} />)

    await userEvent.selectOptions(
      await screen.findByLabelText('ほかの Shot の最初のフレームを使う'),
      FIRST.id,
    )

    await waitFor(() => {
      expect(fake.setEndFrame).toHaveBeenCalledWith(SHOT_ID, 'asset-first')
    })
    expect(fake.getStartFrame).toHaveBeenCalledWith(FIRST.id)
    expect((await screen.findByAltText('終わりの画像')).getAttribute('data-asset')).toBe('asset-first')
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('外すと消え、読み直させる。開いただけでは読み直させない', async () => {
    const fake = api('asset-old')
    const onSaved = vi.fn()
    render(<EndFrameField shot={shot} workspaceId={WORKSPACE} candidates={candidates} api={fake} onSaved={onSaved} />)
    await screen.findByAltText('終わりの画像')
    expect(onSaved).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '終わりの画像を外す' }))

    expect(fake.clearEndFrame).toHaveBeenCalledWith(SHOT_ID)
    await waitFor(() => {
      expect(screen.queryByAltText('終わりの画像')).toBeNull()
    })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('外せなければ理由を出す', async () => {
    const fake = { ...api('asset-old'), clearEndFrame: vi.fn(() => Promise.reject(new Error('だめ'))) }
    render(<EndFrameField shot={shot} workspaceId={WORKSPACE} candidates={candidates} api={fake} />)
    await screen.findByAltText('終わりの画像')

    await userEvent.click(screen.getByRole('button', { name: '終わりの画像を外す' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/外せませんでした/)
  })

  it('最初のフレームが付いたほかの Shot が無ければ、選ぶ欄を出さない', async () => {
    render(<EndFrameField shot={shot} workspaceId={WORKSPACE} candidates={[]} api={api(null)} />)

    await screen.findByText(END_FRAME_NOTE)
    await screen.findByRole('button', { name: '終わりの画像を付ける' })
    expect(screen.queryByLabelText('ほかの Shot の最初のフレームを使う')).toBeNull()
  })
})
