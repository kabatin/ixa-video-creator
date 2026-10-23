import { describe, expect, it } from 'vitest'
import type { TakeId } from '@ixa/domain'
import { reviewWhenAutoRetake } from '../auto-review.js'
import { aProject, aShot, aTake, aVideoAsset, inMemoryTakes, silentLogger } from './doubles.js'

/**
 * 自動の作り直しを選んだ Take は、取り込みが済んだら自動でレビューを積む（ADR-0057。夜間の自走）。
 * 選んでいなければ積まない（既定。レビューは人が頼む）。
 */

const setup = (patch: Parameters<typeof aTake>[2] = {}) => {
  const project = aProject()
  const shot = aShot(project)
  const asset = aVideoAsset(project)
  const take = aTake(shot, asset.id, patch)
  const enqueued: TakeId[] = []
  const hook = reviewWhenAutoRetake({
    takes: inMemoryTakes([take]),
    reviewQueue: { enqueue: (takeId) => Promise.resolve(void enqueued.push(takeId)) },
    logger: silentLogger,
  })
  const generated = { ...asset, origin: { type: 'generated' as const, takeId: take.id } }
  return { take, asset, generated, hook, enqueued }
}

describe('reviewWhenAutoRetake', () => {
  it('自動の作り直しを選んだ Take の素材なら、レビューを積む', async () => {
    const f = setup({ autoRetake: true })
    await f.hook(f.generated)
    expect(f.enqueued).toEqual([f.take.id])
  })

  it('選んでいなければ積まない（既定）', async () => {
    const f = setup({ autoRetake: false })
    await f.hook(f.generated)
    expect(f.enqueued).toEqual([])
  })

  it('もうレビューした Take は積まない', async () => {
    const f = setup({ autoRetake: true, reviewStatus: 'failed' })
    await f.hook(f.generated)
    expect(f.enqueued).toEqual([])
  })

  it('生成した素材でなければ見ない（取り込んだ画像・書き出しなど）', async () => {
    const f = setup({ autoRetake: true })
    await f.hook({ ...f.asset, origin: { type: 'upload', uploadedBy: 'test' } })
    expect(f.enqueued).toEqual([])
  })
})
