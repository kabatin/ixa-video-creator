import { describe, expect, it } from 'vitest'
import { describeActiveUpscale } from '@/lib/upscale-progress'
import type { WireActiveUpscale } from '@/lib/upscale-activity-api'

/** 超解像の待ち・作成中を一覧の 1 語にする（制作者 2026-10-19）。経過は送ってから、見込みはサーバの値。 */
const upscale = (patch: Partial<WireActiveUpscale> = {}): WireActiveUpscale => ({
  jobId: 'j1',
  shotId: 's1',
  sourceTakeId: 't1',
  status: 'running',
  queuedAt: '2026-10-19T10:00:00.000Z',
  startedAt: '2026-10-19T10:00:00.000Z',
  estimateSeconds: 240,
  ...patch,
})

const at = (sec: number): number => Date.parse('2026-10-19T10:00:00.000Z') + sec * 1000

describe('describeActiveUpscale', () => {
  it('作成中は経過と見込み', () => {
    expect(describeActiveUpscale(upscale(), at(151))).toBe('超解像中 2:31 / 約 4 分')
  })

  it('見込みが無ければ経過だけ', () => {
    expect(describeActiveUpscale(upscale({ estimateSeconds: null }), at(151))).toBe('超解像中 2:31')
  })

  it('待っている間は「超解像待ち」', () => {
    expect(describeActiveUpscale(upscale({ status: 'queued', startedAt: null, estimateSeconds: null }), at(30))).toBe(
      '超解像待ち',
    )
  })
})
