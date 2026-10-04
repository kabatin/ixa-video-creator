import type { ProjectId } from '@ixa/domain'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useActiveGenerations } from '@/components/workbench/use-active-generations'
import type { GenerationActivityApi, WireActiveGeneration } from '@/lib/generation-activity-api'

/**
 * 動いている生成を追う。**生成中の Shot があるあいだだけ**、5 秒おきにサーバへ聞く（無駄に叩かない）。
 */

const PROJECT = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as ProjectId

const entry = (shotId: string, status: 'queued' | 'running' = 'running'): WireActiveGeneration => ({
  jobId: `job-${shotId}-${status}`,
  shotId,
  status,
  modelId: 'm',
  modelLabel: 'モデル',
  estimatedLatencySec: 60,
  queuedAt: '2026-09-30T10:00:00.000Z',
  startedAt: status === 'running' ? '2026-09-30T10:00:05.000Z' : null,
  providerStartedAt: status === 'running' ? '2026-09-30T10:00:05.000Z' : null,
  attempt: 1,
})

const apiWith = (
  entries: readonly WireActiveGeneration[],
): Pick<GenerationActivityApi, 'listActiveGenerations'> & { calls: () => number } => {
  let count = 0
  return {
    listActiveGenerations: () => {
      count += 1
      return Promise.resolve(entries)
    },
    calls: () => count,
  }
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

describe('useActiveGenerations', () => {
  it('生成中の Shot が無ければ聞かない', async () => {
    const api = apiWith([])
    renderHook(() => useActiveGenerations(api, PROJECT, false))
    await flush()
    await act(async () => {
      vi.advanceTimersByTime(20_000)
      await Promise.resolve()
    })

    expect(api.calls()).toBe(0)
  })

  it('生成中なら、すぐ聞いて、5 秒おきに聞き直す', async () => {
    const api = apiWith([entry('shot-1')])
    const { result } = renderHook(() => useActiveGenerations(api, PROJECT, true))
    await flush()

    expect(api.calls()).toBe(1)
    expect(result.current.get('shot-1')?.[0]?.status).toBe('running')

    await act(async () => {
      vi.advanceTimersByTime(5_000)
      await Promise.resolve()
    })
    expect(api.calls()).toBe(2)
  })

  it('同じ Shot に作成中と順番待ちがあれば、作成中を先に並べる', async () => {
    const api = apiWith([entry('shot-1', 'queued'), entry('shot-1', 'running')])
    const { result } = renderHook(() => useActiveGenerations(api, PROJECT, true))
    await flush()

    expect(result.current.get('shot-1')?.map((generation) => generation.status)).toEqual([
      'running',
      'queued',
    ])
  })

  it('生成中でなくなったら空にし、聞くのをやめる', async () => {
    const api = apiWith([entry('shot-1')])
    const { result, rerender } = renderHook(({ on }) => useActiveGenerations(api, PROJECT, on), {
      initialProps: { on: true },
    })
    await flush()

    rerender({ on: false })
    await act(async () => {
      vi.advanceTimersByTime(20_000)
      await Promise.resolve()
    })

    expect(result.current.size).toBe(0)
    expect(api.calls()).toBe(1)
  })
})
