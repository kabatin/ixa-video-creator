import type { ImageGenerationJobId, MediaAssetId, Shot, WorkspaceId } from '@ixa/domain'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StartFrameField } from '@/components/workbench/inspector/start-frame-field'
import type { ShotStartFrameApi, WireStartFrameState } from '@/lib/shot-start-frame-api'
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

const api = (current: string | null, job: WireStartFrameState['job'] = null): ShotStartFrameApi => ({
  getStartFrame: vi.fn(() => Promise.resolve({ mediaAssetId: current as MediaAssetId | null, job })),
  setStartFrame: vi.fn((_shot, mediaAssetId: MediaAssetId) => Promise.resolve({ mediaAssetId })),
  clearStartFrame: vi.fn(() => Promise.resolve()),
  generateStartFrame: vi.fn(() => Promise.resolve({ jobId: JOB })),
  generateStartFrames: vi.fn(() => Promise.resolve({ jobIds: [], skipped: { drawing: 0, hasFrame: 0 } })),
})

const JOB = '01ARZ3NDEKTSV4RRFFQ69G5FJ0' as ImageGenerationJobId

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

/**
 * 付け外ししたら知らせる（制作者 2026-10-02。Take が無い Shot はプレビューに絵を映すので、サムネとプレビューを読み直させる）。
 * 読み込んだだけでは知らせない（開くたびに全部読み直さない）。
 */
describe('StartFrameField の付け外しを知らせる', () => {
  it('付けたら・外したら onSaved を呼び、開いただけでは呼ばない', async () => {
    const fake = api('asset-old')
    const onSaved = vi.fn()
    render(<StartFrameField shot={shot} workspaceId={WORKSPACE} api={fake} onSaved={onSaved} />)
    await screen.findByAltText('最初のフレーム')
    expect(onSaved).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '外す' }))
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1)
    })

    await userEvent.click(await screen.findByRole('button', { name: '画像を付ける' }))
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(2)
    })
  })
})

/**
 * 絵コンテの画像を AI で作る（ADR-0029）。押すと作り始め、できたら最初のフレームが差し替わる
 * （worker が出来事で知らせ、`version` が変わって読み直す）。作っている間と失敗は直近のジョブで言う。
 */
describe('StartFrameField の AI で作る', () => {
  it('絵が無ければ「AI で絵を作る」。押すと作り始め、作っていると言う', async () => {
    const fake = api(null)
    render(<StartFrameField shot={shot} workspaceId={WORKSPACE} api={fake} />)

    await userEvent.click(await screen.findByRole('button', { name: 'AI で絵を作る' }))

    expect(fake.generateStartFrame).toHaveBeenCalledWith(SHOT_ID)
    expect(await screen.findByText(/絵コンテの画像を作っています/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'AI で絵を作る' })).toHaveProperty('disabled', true)
  })

  it('絵があれば「AI で作り直す」', async () => {
    render(<StartFrameField shot={shot} workspaceId={WORKSPACE} api={api('asset-old')} />)

    expect(await screen.findByRole('button', { name: 'AI で作り直す' })).toBeTruthy()
  })

  it('開き直しても、作っている間はそう言って押せない', async () => {
    render(
      <StartFrameField shot={shot} workspaceId={WORKSPACE} api={api(null, { id: JOB, status: 'running', error: null })} />,
    )

    expect(await screen.findByText(/絵コンテの画像を作っています/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'AI で絵を作る' })).toHaveProperty('disabled', true)
  })

  it('失敗したら理由をそのまま出す（もう一度押せる）', async () => {
    render(
      <StartFrameField
        shot={shot}
        workspaceId={WORKSPACE}
        api={api(null, { id: JOB, status: 'failed', error: 'Codex CLI が絵を返しませんでした。' })}
      />,
    )

    expect((await screen.findByRole('alert')).textContent).toContain('Codex CLI が絵を返しませんでした。')
    expect(screen.getByRole('button', { name: 'AI で絵を作る' })).toHaveProperty('disabled', false)
  })

  it('頼めなかったら理由を出す（作っている表示にしない）', async () => {
    const fake = { ...api(null), generateStartFrame: vi.fn(() => Promise.reject(new Error('この Shot の絵コンテの画像を作っています。'))) }
    render(<StartFrameField shot={shot} workspaceId={WORKSPACE} api={fake} />)

    await userEvent.click(await screen.findByRole('button', { name: 'AI で絵を作る' }))

    expect((await screen.findByRole('alert')).textContent).toContain('頼めませんでした')
  })
})
