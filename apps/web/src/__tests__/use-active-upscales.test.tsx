import type { ProjectId } from '@ixa/domain'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useActiveUpscales } from '@/components/workbench/use-active-upscales'
import type { UpscaleActivityApi, WireActiveUpscale } from '@/lib/upscale-activity-api'

/**
 * 動いている超解像を追う。超解像は Shot の状態を変えないので、開いたとき・超解像の出来事が来たときに聞き、
 * **ジョブがあるあいだだけ** 5 秒おきに聞き直す。消えたら（終わったら）Take を読み直させる。
 */

const PROJECT = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as ProjectId

const entry = (shotId: string, status: 'queued' | 'running' = 'running'): WireActiveUpscale => ({
  jobId: `job-${shotId}-${status}`,
  shotId,
  sourceTakeId: `take-${shotId}`,
  status,
  queuedAt: '2026-10-19T10:00:00.000Z',
  startedAt: status === 'running' ? '2026-10-19T10:00:05.000Z' : null,
  estimateSeconds: status === 'running' ? 240 : null,
})

const apiOf = (responses: readonly (readonly WireActiveUpscale[])[]) => {
  let count = 0
  const api: Pick<UpscaleActivityApi, 'listActiveUpscales'> = {
    listActiveUpscales: () => {
      const response = responses[Math.min(count, responses.length - 1)] ?? []
      count += 1
      return Promise.resolve(response)
    },
  }
  return { api, calls: () => count }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

const flush = () =>
  act(async () => {
    await Promise.resolve()
  })
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
  })

describe('useActiveUpscales', () => {
  it('開いたときに 1 回聞き、無ければそれ以上聞かない', async () => {
    const { api, calls } = apiOf([[]])
    renderHook(() => useActiveUpscales(api, PROJECT, 0, vi.fn()))
    await flush()
    await advance(30_000)
    expect(calls()).toBe(1)
  })

  it('あるあいだは 5 秒おきに聞き、Shot ごとに作成中を先に並べる', async () => {
    const { api, calls } = apiOf([[entry('a', 'queued'), entry('a', 'running'), entry('b', 'queued')]])
    const { result } = renderHook(() => useActiveUpscales(api, PROJECT, 0, vi.fn()))
    await flush()
    expect(result.current.get('a')?.map((u) => u.status)).toEqual(['running', 'queued'])
    expect(result.current.get('b')?.[0]?.status).toBe('queued')
    await advance(10_000)
    expect(calls()).toBe(3)
  })

  it('終わって消えたら Take を読み直させ、聞くのをやめる', async () => {
    const onFinished = vi.fn()
    const { api, calls } = apiOf([[entry('a')], []])
    const { result } = renderHook(() => useActiveUpscales(api, PROJECT, 0, onFinished))
    await flush()
    await advance(5_000)
    expect(result.current.size).toBe(0)
    expect(onFinished).toHaveBeenCalledTimes(1)
    await advance(30_000)
    expect(calls()).toBe(2)
  })

  it('超解像の出来事（合図）が来たら聞き直す', async () => {
    const { api, calls } = apiOf([[], [entry('a')]])
    const { result, rerender } = renderHook(({ epoch }) => useActiveUpscales(api, PROJECT, epoch, vi.fn()), {
      initialProps: { epoch: 0 },
    })
    await flush()
    rerender({ epoch: 1 })
    await flush()
    expect(calls()).toBe(2)
    expect(result.current.get('a')).toHaveLength(1)
  })
})
