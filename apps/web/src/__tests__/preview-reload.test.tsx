import { TakeId } from '@ixa/domain'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PreferencesRoot } from '@/components/preferences-root'
import { PreviewPanel } from '@/components/workbench/panels/preview-panel'
import { ContextMenuHost } from '@/components/workbench/ui/context-menu'
import { WorkbenchContext, type WorkbenchContextValue } from '@/components/workbench/workbench-context'
import { WorkbenchTransportProvider } from '@/components/workbench/workbench-transport-provider'
import { timelineShotsKey } from '@/lib/timeline-shots-key'
import { TAKE_ID } from './fixtures'
import { STOPPED, aWorkbenchShot, workbenchValue } from './workbench-fixture'

/**
 * Shot の尺を変えたら、プレビューの組み立て結果を読み直す
 * （制作者 2026-10-02「CUT1の尺をCUT2に繋がるように伸ばしたんだけど、動画が伸ばされていないように見受けられる」）。
 * サーバは伸ばした尺と速度（0.93 倍）を返していたが、画面は読み直す合図（生成の完了・画面の読み直し）しか見ておらず、
 * 尺を変える前の組み立て結果を映し続けていた。
 */

const loader = vi.hoisted(() => ({ loadTimelineDocument: vi.fn() }))
vi.mock('@/lib/timeline-loader', () => loader)
vi.mock('@/components/program-monitor', () => ({ ProgramMonitor: () => null }))
vi.mock('@/components/workbench/transport-bar', () => ({ TransportBar: () => null }))

const shot = aWorkbenchShot(1, { durationSec: 10.13, timing: 'fit' })

const tree = (value: WorkbenchContextValue) => (
  <PreferencesRoot>
    <WorkbenchContext.Provider value={value}>
      <WorkbenchTransportProvider transport={STOPPED}>
        <ContextMenuHost>
          <PreviewPanel />
        </ContextMenuHost>
      </WorkbenchTransportProvider>
    </WorkbenchContext.Provider>
  </PreferencesRoot>
)

beforeEach(() => {
  loader.loadTimelineDocument.mockReset()
  loader.loadTimelineDocument.mockResolvedValue({ value: null, error: null })
})

describe('プレビューの読み直し', () => {
  it('Shot の尺を変えたら読み直す', async () => {
    const { rerender } = render(tree(workbenchValue({ shots: [shot] })))
    await waitFor(() => {
      expect(loader.loadTimelineDocument).toHaveBeenCalledTimes(1)
    })

    rerender(tree(workbenchValue({ shots: [{ ...shot, durationSec: 10.89 }] })))

    await waitFor(() => {
      expect(loader.loadTimelineDocument).toHaveBeenCalledTimes(2)
    })
  })

  it('組み立てに効かない欄（説明）を変えただけでは読み直さない', async () => {
    const { rerender } = render(tree(workbenchValue({ shots: [shot] })))
    await waitFor(() => {
      expect(loader.loadTimelineDocument).toHaveBeenCalledTimes(1)
    })

    rerender(tree(workbenchValue({ shots: [{ ...shot, description: '別の説明' }] })))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(loader.loadTimelineDocument).toHaveBeenCalledTimes(1)
  })
})

describe('timelineShotsKey', () => {
  it.each([
    ['開始', { startSec: 1 }],
    ['尺', { durationSec: 10.89 }],
    ['尺に合わせるか', { timing: 'trim' as const }],
    ['切り出す位置', { sourceInSec: 0.5 }],
    ['採用 Take', { selectedTakeId: TakeId.parse(TAKE_ID) }],
  ])('%s が変われば変わる', (_label, patch) => {
    expect(timelineShotsKey([{ ...shot, ...patch }])).not.toBe(timelineShotsKey([shot]))
  })

  it('Shot が増えれば変わり、読めていなければ空', () => {
    expect(timelineShotsKey([shot, aWorkbenchShot(2)])).not.toBe(timelineShotsKey([shot]))
    expect(timelineShotsKey(null)).toBe('')
  })
})
