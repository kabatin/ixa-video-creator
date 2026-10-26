import { describe, expect, it } from 'vitest'
import { ACTIVE_JOB_KINDS, STALE_AFTER_MS, summarizeActiveRows } from '../active-jobs.js'

const NOW = new Date('2026-10-27T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('summarizeActiveRows（動いているジョブの数え方）', () => {
  it('種類ごとに数え、無い種類は 0', () => {
    const { counts, stale } = summarizeActiveRows(
      [
        { kind: 'render', id: 'r1', since: ago(60_000) },
        { kind: 'render', id: 'r2', since: ago(1000) },
        { kind: 'storyboard', id: 's1', since: ago(5000) },
      ],
      NOW,
    )
    expect(counts.render).toBe(2)
    expect(counts.storyboard).toBe(1)
    expect(counts.generation).toBe(0)
    expect(Object.keys(counts).sort()).toEqual([...ACTIVE_JOB_KINDS].sort())
    expect(stale).toEqual([])
  })

  it('24 時間より前から動いたままの行は数えず、取り残しとして並べる（ずっと止められないように）', () => {
    const old = ago(STALE_AFTER_MS + 1)
    const { counts, stale } = summarizeActiveRows(
      [
        { kind: 'storyboard', id: '01M4AGD9ACE64Q8036GVQM0YHA', since: old },
        { kind: 'agent', id: 'a1', since: ago(STALE_AFTER_MS - 1000) },
      ],
      NOW,
    )
    expect(counts.storyboard).toBe(0)
    expect(counts.agent).toBe(1)
    expect(stale).toEqual([{ kind: 'storyboard', id: '01M4AGD9ACE64Q8036GVQM0YHA', since: old.toISOString() }])
  })

  it('絵コンテの案・レビュー・サムネイルも数える', () => {
    expect(ACTIVE_JOB_KINDS).toEqual(expect.arrayContaining(['storyboard', 'review', 'thumbnail']))
  })
})
