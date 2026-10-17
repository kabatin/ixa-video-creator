import { ThumbnailSpec, type Thumbnail, type ThumbnailId } from '@ixa/domain'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { failInterruptedThumbnailJob } from '../interrupted.js'

/** キューに打ち切られたサムネイルの行を失敗にする（処理の外で止まると「描いています」のまま残るため）。 */

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as ThumbnailId

const aThumbnail = (status: Thumbnail['status']): Thumbnail => ({
  id: ID,
  projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' as Thumbnail['projectId'],
  spec: ThumbnailSpec.parse({ background: { kind: 'timeline_frame', atSec: 1 }, title: '新曲' }),
  status,
  outputAssetId: null,
  fileName: 'a サムネ 2026-10-17 10.00.00.jpg',
  error: null,
  createdAt: new Date(),
  finishedAt: null,
})

const setup = (status: Thumbnail['status']) => {
  const lines: string[] = []
  const logger = pino({ level: 'debug' }, { write: (line: string) => lines.push(line) })
  const markFailed = vi.fn(() => Promise.resolve(aThumbnail('failed')))
  const deps = { thumbnails: { findById: () => Promise.resolve(aThumbnail(status)), markFailed }, logger }
  return { deps, markFailed, lines }
}

describe('failInterruptedThumbnailJob', () => {
  it('描いている途中の行を失敗にし、キューの理由の URL はログに残さない', async () => {
    const { deps, markFailed, lines } = setup('rendering')
    await failInterruptedThumbnailJob(deps, { thumbnailId: ID, timeline: null }, 'stalled https://minio/x?X-Amz-Signature=abc')
    expect(markFailed).toHaveBeenCalledWith(ID, expect.stringContaining('もう一度'))
    expect(lines.join('')).not.toContain('X-Amz-Signature')
  })

  it('終わった行は触らない', async () => {
    const { deps, markFailed } = setup('done')
    await failInterruptedThumbnailJob(deps, { thumbnailId: ID, timeline: null }, 'stalled')
    expect(markFailed).not.toHaveBeenCalled()
  })

  it('読めないデータでも投げない', async () => {
    const { deps, markFailed } = setup('rendering')
    await expect(failInterruptedThumbnailJob(deps, { nope: 1 }, 'stalled')).resolves.toBeUndefined()
    expect(markFailed).not.toHaveBeenCalled()
  })
})
