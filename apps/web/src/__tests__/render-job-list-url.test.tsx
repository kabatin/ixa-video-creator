import { MediaAssetId, RenderJobId } from '@ixa/domain'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RenderFolder } from '@/components/render-folder'
import { RenderJobList } from '@/components/render-job-list'
import { WireRenderJob } from '@/lib/render-api'
import { PROJECT_ID } from './fixtures'

/**
 * 書き出した動画の URL（5 分）を持ち続けない（2026-10-18）。
 * 以前は「再生」で取った URL を「別のタブで開く」にも使い回し、5 分を過ぎて押すと 403 の画面が開いた。
 */

const OUTPUT_ID = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC1')
const done = WireRenderJob.parse({
  id: RenderJobId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC0'),
  projectId: PROJECT_ID,
  scope: { type: 'full' },
  preset: 'preview_720p',
  status: 'succeeded',
  progress: 1,
  outputAssetId: OUTPUT_ID,
  error: null,
  createdAt: '2026-10-02T13:52:00.000Z',
  finishedAt: '2026-10-02T13:54:03.000Z',
})

const folder: RenderFolder = {
  location: null,
  canOpen: false,
  opening: false,
  notice: null,
  open: () => undefined,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('書き出しの「別のタブで開く」', () => {
  it('押したときに URL を取り直して開く（再生で取った URL を使い回さない）', async () => {
    const resolveOutputUrl = vi
      .fn<(id: MediaAssetId) => Promise<string>>()
      .mockResolvedValueOnce('https://example.invalid/play.mp4')
      .mockResolvedValueOnce('https://example.invalid/tab.mp4')
    const tab = { opener: {}, location: { href: '' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    render(<RenderJobList jobs={[done]} error={null} nowMs={null} resolveOutputUrl={resolveOutputUrl} folder={folder} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '再生' }))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '別のタブで開く' }))
      await Promise.resolve()
    })

    expect(resolveOutputUrl).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(tab.opener).toBeNull()
    expect(tab.location.href).toBe('https://example.invalid/tab.mp4')
  })
})
