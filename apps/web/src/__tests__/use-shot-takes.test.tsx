import { Take } from '@ixa/domain'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useShotTakes } from '@/components/workbench/use-shot-takes'
import { takeJson } from './fixtures'
import { aWorkbenchShot } from './workbench-fixture'

/**
 * Shot を替えた直後に**前の Shot の Take を渡さない**（実機で 404 になった。2026-09-19）。
 */

const pending = new Map<string, (takes: Take[]) => void>()

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => ({
    listTakes: (shotId: string) =>
      new Promise<Take[]>((resolve) => {
        pending.set(shotId, resolve)
      }),
  }),
}))

const aTake = (shotId: string): Take =>
  Take.parse({ ...takeJson, shotId, spec: { ...takeJson.spec, shotId }, createdAt: new Date(), reviewedAt: null })

describe('useShotTakes', () => {
  it('Shot を替えたら、新しい Take が届くまで null（前の Shot の Take を返さない）', async () => {
    const first = aWorkbenchShot(1)
    const second = aWorkbenchShot(2)
    const { result, rerender } = renderHook(({ shot }) => useShotTakes(shot, 0), {
      initialProps: { shot: first },
    })

    pending.get(first.id)?.([aTake(first.id)])
    await waitFor(() => {
      expect(result.current.takes).toHaveLength(1)
    })

    rerender({ shot: second })
    expect(result.current.takes).toBeNull()

    pending.get(second.id)?.([aTake(second.id), aTake(second.id)])
    await waitFor(() => {
      expect(result.current.takes).toHaveLength(2)
    })
  })
})
