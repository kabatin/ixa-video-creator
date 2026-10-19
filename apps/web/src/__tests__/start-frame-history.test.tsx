import type { ImageGenerationJobId, MediaAssetId } from '@ixa/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StartFrameHistory } from '@/components/workbench/inspector/start-frame-history'
import type { WireImageHistoryEntry } from '@/lib/image-check'

/**
 * 開始フレームとして作った絵の履歴の帯（ADR-0055）。作った順に並べ、印と理由を出し、押すと拡大して選び直せる。
 */

vi.mock('@/components/media-image', () => ({
  MediaImage: ({ mediaAssetId, alt }: { mediaAssetId: string; alt: string }) => <img alt={alt} data-asset={mediaAssetId} />,
}))

const entry = (patch: Partial<WireImageHistoryEntry>): WireImageHistoryEntry => ({
  jobId: '01ARZ3NDEKTSV4RRFFQ69G5FJ1' as ImageGenerationJobId,
  status: 'succeeded',
  attempt: 1,
  retryOfJobId: null,
  mediaAssetId: 'asset-1' as MediaAssetId,
  applied: false,
  current: false,
  check: null,
  error: null,
  queuedAt: new Date('2026-10-19T00:00:00Z'),
  ...patch,
})

const retried = entry({
  check: { mark: 'retry', outcome: 'checked', score: 0.2, issues: [{ kind: 'anatomy', message: '右手の指が 6 本あります' }], note: null },
})
const passed = entry({
  jobId: '01ARZ3NDEKTSV4RRFFQ69G5FJ2' as ImageGenerationJobId,
  attempt: 2,
  mediaAssetId: 'asset-2' as MediaAssetId,
  applied: true,
  current: true,
  queuedAt: new Date('2026-10-19T00:01:00Z'),
  check: { mark: 'pass', outcome: 'checked', score: 0.9, issues: [], note: null },
})

describe('StartFrameHistory', () => {
  it('作った順に並べ、印と使用中を出す（絵の無いジョブは出さない）', () => {
    render(
      <StartFrameHistory
        entries={[passed, retried, entry({ jobId: '01ARZ3NDEKTSV4RRFFQ69G5FJ3' as ImageGenerationJobId, status: 'failed', mediaAssetId: null })]}
        disabled={false}
        onUse={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    const thumbs = screen.getAllByRole('img').map((img) => img.getAttribute('data-asset'))
    expect(thumbs).toEqual(['asset-1', 'asset-2'])
    expect(screen.getByText('やり直し')).toBeTruthy()
    expect(screen.getByText('○ 問題なし')).toBeTruthy()
    expect(screen.getByText('使用中')).toBeTruthy()
    expect(screen.getByText('やり直し').getAttribute('title')).toBe('右手の指が 6 本あります')
  })

  it('押すと拡大し、理由と「これを使う」を出す。使うとその絵を知らせる', async () => {
    const onUse = vi.fn()
    render(<StartFrameHistory entries={[passed, retried]} disabled={false} onUse={onUse} onRetry={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: '1 枚目を拡大する' }))
    expect(screen.getByAltText('拡大した絵').getAttribute('data-asset')).toBe('asset-1')
    expect(screen.getByText('右手の指が 6 本あります')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'これを使う' }))
    expect(onUse).toHaveBeenCalledWith('asset-1')
  })

  it('いま使っている絵は「使っています」で押せない。やり直すはそのジョブを知らせる', async () => {
    const onRetry = vi.fn()
    render(<StartFrameHistory entries={[passed, retried]} disabled={false} onUse={vi.fn()} onRetry={onRetry} />)

    await userEvent.click(screen.getByRole('button', { name: '2 枚目を拡大する' }))
    expect(screen.getByRole('button', { name: '使っています' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('やり直し 1 回目')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'やり直す' }))
    expect(onRetry).toHaveBeenCalledWith(passed.jobId)
  })

  it('作っている最中は押せない', async () => {
    render(<StartFrameHistory entries={[passed, retried]} disabled onUse={vi.fn()} onRetry={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '1 枚目を拡大する' }))
    expect(screen.getByRole('button', { name: 'これを使う' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'やり直す' }).hasAttribute('disabled')).toBe(true)
  })

  it('絵が 1 枚も無ければ何も出さない', () => {
    const { container } = render(<StartFrameHistory entries={[]} disabled={false} onUse={vi.fn()} onRetry={vi.fn()} />)
    expect(container.textContent).toBe('')
  })
})
