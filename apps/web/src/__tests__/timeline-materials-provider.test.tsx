import { act, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  TimelineMaterialsProvider,
  useTimelineMaterials,
} from '@/components/workbench/timeline-materials-provider'
import type { TimelineMaterials } from '@/lib/timeline-loader'
import { renderInWorkbench } from './workbench-fixture'

/**
 * タイムラインの材料はワークベンチに 1 つ（レビュー 2026-10-19）。
 * タイムラインと検査のタブが別々に取ると、取得が 2 回走り、
 * 片方だけ取り直したとき（クリップを置いた・動かした）に検査が古いまま残った。
 */

const loader = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/lib/timeline-loader', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/timeline-loader')>()
  return { ...original, loadTimelineMaterials: loader.load }
})

const materials = (issueCount: number): TimelineMaterials => ({
  transitions: { value: [], error: null },
  clips: { value: [], error: null },
  document: { value: null, error: null },
  issues: {
    value: Array.from({ length: issueCount }, () => ({ code: 'shot_gap', severity: 'warning', message: 'm' })) as never,
    error: null,
  },
  beatSource: { state: 'no_track' },
  beatAlignment: { value: null, error: null },
})

let reload: (() => void) | null = null
const Reader = ({ name }: { readonly name: string }) => {
  const shared = useTimelineMaterials()
  reload = shared.reload
  return <p>{`${name}: ${shared.materials === null ? '読み込み中' : String(shared.materials.issues.value?.length)}`}</p>
}

describe('TimelineMaterialsProvider', () => {
  it('2 つのタブが読んでも取得は 1 回。取り直すと両方が新しい材料を見る', async () => {
    loader.load.mockResolvedValueOnce(materials(1)).mockResolvedValueOnce(materials(3))
    renderInWorkbench(
      <TimelineMaterialsProvider>
        <Reader name="タイムライン" />
        <Reader name="検査" />
      </TimelineMaterialsProvider>,
    )
    await screen.findByText('タイムライン: 1')
    expect(screen.getByText('検査: 1')).toBeTruthy()
    expect(loader.load).toHaveBeenCalledTimes(1)

    act(() => {
      reload?.()
    })
    await waitFor(() => {
      expect(screen.getByText('検査: 3')).toBeTruthy()
    })
    expect(screen.getByText('タイムライン: 3')).toBeTruthy()
    expect(loader.load).toHaveBeenCalledTimes(2)
  })
})
