import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreferencesRoot } from '@/components/preferences-root'
import { PreviewPanel } from '@/components/workbench/panels/preview-panel'
import { ContextMenuHost } from '@/components/workbench/ui/context-menu'
import { WorkbenchContext } from '@/components/workbench/workbench-context'
import { WorkbenchTransportProvider } from '@/components/workbench/workbench-transport-provider'
import { STOPPED, aWorkbenchShot, workbenchValue } from './workbench-fixture'

/**
 * プレビューの材料（TimelineDocument）の中の URL は 1 時間で切れる（2026-10-18）。
 * 以前は読み直す合図（生成・尺の変更など）が来ない限り取り直さず、開いたまま 1 時間を過ぎると
 * 素材を読めなくなっても「モニター: 素材を読めません」と出すだけだった。
 */

const loader = vi.hoisted(() => ({ loadTimelineDocument: vi.fn() }))
vi.mock('@/lib/timeline-loader', () => loader)
/** モニターは差し替え、渡された「素材を読めなかった」の口だけを控える。 */
const monitor = vi.hoisted(() => ({ onMediaError: null as (() => void) | null }))
vi.mock('@/components/program-monitor', () => ({
  ProgramMonitor: (props: { readonly onMediaError?: () => void }) => {
    monitor.onMediaError = props.onMediaError ?? null
    return null
  },
}))
vi.mock('@/components/workbench/transport-bar', () => ({ TransportBar: () => null }))

const DOCUMENT = { durationSec: 10, video1: [] }

const renderPreview = () =>
  render(
    <PreferencesRoot>
      <WorkbenchContext.Provider value={workbenchValue({ shots: [aWorkbenchShot(1)] })}>
        <WorkbenchTransportProvider transport={STOPPED}>
          <ContextMenuHost>
            <PreviewPanel />
          </ContextMenuHost>
        </WorkbenchTransportProvider>
      </WorkbenchContext.Provider>
    </PreferencesRoot>,
  )

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-18T00:00:00Z'))
  loader.loadTimelineDocument.mockReset()
  loader.loadTimelineDocument.mockResolvedValue({ value: DOCUMENT, error: null })
  monitor.onMediaError = null
})
afterEach(() => {
  vi.useRealTimers()
})

describe('プレビューの材料の取り直し', () => {
  it('URL が切れる前（1 時間の 8 割）に取り直す', async () => {
    renderPreview()
    await flush()
    expect(loader.loadTimelineDocument).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_880_000 - 1)
    })
    expect(loader.loadTimelineDocument).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    await flush()
    expect(loader.loadTimelineDocument).toHaveBeenCalledTimes(2)
  })

  it('素材を読めなかったら取り直す。取ったばかりなら取り直さない（素材そのものが無い）', async () => {
    renderPreview()
    await flush()
    expect(monitor.onMediaError).not.toBeNull()

    act(() => {
      monitor.onMediaError?.()
    })
    await flush()
    expect(loader.loadTimelineDocument).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    act(() => {
      monitor.onMediaError?.()
    })
    await flush()
    expect(loader.loadTimelineDocument).toHaveBeenCalledTimes(2)
  })
})
