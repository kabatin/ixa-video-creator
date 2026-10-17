import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchProvider } from '@/components/workbench/workbench-provider'
import { aProject, aWorkbenchShot } from './workbench-fixture'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

/**
 * Shot のサムネイルの URL（5 分）を**切れる前に**引き直す（2026-10-18）。
 * 以前は読めなかった絵があったときだけ引き直しており、API のログに期限切れの拒否が積もっていた。
 */

const listShotPosters = vi.hoisted(() => vi.fn())
/** サムネイル以外の呼び出しは返さない（この検査には関わらない）。 */
vi.mock('@/lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api-client')>()
  return {
    ...original,
    createApiClient: () =>
      new Proxy(
        { listShotPosters },
        {
          get: (target, key) =>
            key === 'listShotPosters' ? target.listShotPosters : () => new Promise(() => undefined),
        },
      ),
  }
})

const SHOT = aWorkbenchShot(1)

const renderWorkbench = () =>
  render(
    <WorkbenchProvider
      project={aProject}
      initialShots={[SHOT]}
      track={null}
      analysis={null}
      musicLoaded={false}
      sequences={[]}
      locations={[]}
      loadErrors={[]}
      initialShotId={null}
      initialDialog={null}
      initialInspected={null}
      focusPanel={vi.fn()}
    >
      <span />
    </WorkbenchProvider>,
  )

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-18T00:00:00Z'))
  listShotPosters.mockReset()
  listShotPosters.mockResolvedValue([
    {
      shotId: SHOT.id,
      takeId: null,
      thumbnailUrl: 'https://example.invalid/poster.jpg',
      reason: null,
      pending: false,
      hasStartFrame: false,
      drawing: false,
    },
  ])
})
afterEach(() => {
  vi.useRealTimers()
})

describe('サムネイルの引き直し', () => {
  it('URL が切れる前（5 分の 8 割）に一覧を引き直す', async () => {
    renderWorkbench()
    await flush()
    const first = listShotPosters.mock.calls.length
    expect(first).toBeGreaterThan(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000 - 1)
    })
    expect(listShotPosters).toHaveBeenCalledTimes(first)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    await flush()
    expect(listShotPosters).toHaveBeenCalledTimes(first + 1)

    // 引き直したあとも同じ間で続ける（開いている限り切れた URL を持たない）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000)
    })
    await flush()
    expect(listShotPosters).toHaveBeenCalledTimes(first + 2)
  })
})
