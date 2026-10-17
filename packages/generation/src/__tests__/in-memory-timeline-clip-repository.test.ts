import { ProjectId, TimelineClipId, newId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { createInMemoryTimelineClipRepository } from '../testing/in-memory-telop-repositories.js'

/**
 * `TimelineClipRepository.findById`（ADR-0050。更新の前に今の形を読む）。メモリ版が本物と同じ答えを返すこと。
 * 本物（drizzle）は `deletedAt` が空の行だけを読む（`liveById`）。このリポジトリには DB に繋ぐ検査が無い。
 */
describe('findById', () => {
  const projectId = newId(ProjectId)
  const input = {
    projectId,
    track: 'VFX' as const,
    startSec: 1,
    durationSec: 0.4,
    content: { type: 'motion_graphics' as const, templateKey: 'flash', params: {} },
  }

  it('あるクリップはそのまま返す', async () => {
    const repo = createInMemoryTimelineClipRepository()
    const created = await repo.create(input)
    expect(await repo.findById(created.id)).toEqual(created)
  })

  it('消したクリップと無いクリップは null', async () => {
    const repo = createInMemoryTimelineClipRepository()
    const created = await repo.create(input)
    await repo.softDelete(created.id)
    expect(await repo.findById(created.id)).toBeNull()
    expect(await repo.findById(newId(TimelineClipId))).toBeNull()
  })
})
