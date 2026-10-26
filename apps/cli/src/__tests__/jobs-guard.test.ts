import type { ActiveJobCounts } from '@ixa/db'
import { describe, expect, it } from 'vitest'
import { jobsGuard } from '../update/jobs.js'

const zero: ActiveJobCounts = {
  generation: 0, render: 0, image: 0, music: 0, sfx: 0, upscale: 0, dub: 0, voice: 0, storyboard: 0, review: 0, thumbnail: 0, agent: 0,
}

describe('jobsGuard（数えた結果の扱い）', () => {
  it('数えられたら件数を渡し、取り残しは知らせるだけ', () => {
    const guard = jobsGuard({ kind: 'counted', jobs: { counts: { ...zero, render: 1 }, stale: [] } }, false)
    expect(guard.counts?.render).toBe(1)
    expect(guard.reason).toBeNull()
    expect(guard.steps).toEqual([])
  })

  it('取り残しがあれば知らせる手順を 1 つ足す（止めない）', () => {
    const guard = jobsGuard(
      { kind: 'counted', jobs: { counts: zero, stale: [{ kind: 'storyboard', id: '01X', since: '2026-10-07T00:00:00.000Z' }] } },
      false,
    )
    expect(guard.steps.map((s) => [s.id, s.status])).toEqual([['update.stale-jobs', 'notice']])
  })

  it('DB が動いていなければ 0 件とみなし、理由を残す（止めない）', () => {
    const guard = jobsGuard({ kind: 'not-running', reason: 'DB につながりません' }, false)
    expect(guard.counts).toBeNull()
    expect(guard.reason).toBe('DB につながりません')
    expect(guard.steps.map((s) => s.status)).toEqual(['notice'])
  })

  it('それ以外の失敗（合言葉違いなど）は止める。--force のときだけ知らせて進む', () => {
    const failed = jobsGuard({ kind: 'error', reason: '読めません（28P01）' }, false)
    expect(failed.steps[0]).toMatchObject({ status: 'failed', fix: { needsHuman: true } })
    expect(failed.reason).toBe('読めません（28P01）')
    expect(jobsGuard({ kind: 'error', reason: 'x' }, true).steps[0]?.status).toBe('notice')
  })
})
