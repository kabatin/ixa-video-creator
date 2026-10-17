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
const monitor = vi.hoisted((): { onMediaError: (() => void) | null; document: unknown } => ({
  onMediaError: null,
  document: null,
}))
vi.mock('@/components/program-monitor', () => ({
  ProgramMonitor: (props: { readonly onMediaError?: () => void; readonly document: unknown }) => {
    monitor.onMediaError = props.onMediaError ?? null
    monitor.document = props.document
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
  monitor.document = null
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

  /**
   * 期限の前の取り直しが 1 回落ちても（スリープ明け・通信の瞬断）、映っている絵を失敗で置き換えない。
   * 中の URL はまだ 2 割（12 分）残っている。以前は失敗の値で置き換え、そのあと二度と取り直さなかった。
   */
  it('取り直しに失敗しても前の材料を映したまま、少し待ってもう一度取りにいく', async () => {
    renderPreview()
    await flush()
    expect(monitor.document).toBe(DOCUMENT)

    loader.loadTimelineDocument.mockResolvedValueOnce({ value: null, error: 'TimelineDocument: 通信が切れました' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_880_000)
    })
    await flush()
    expect(loader.loadTimelineDocument).toHaveBeenCalledTimes(2)
    expect(monitor.document).toBe(DOCUMENT)

    const FRESH = { durationSec: 10, video1: [], fresh: true }
    loader.loadTimelineDocument.mockResolvedValueOnce({ value: FRESH, error: null })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    await flush()
    expect(loader.loadTimelineDocument).toHaveBeenCalledTimes(3)
    expect(monitor.document).toBe(FRESH)
  })
})
