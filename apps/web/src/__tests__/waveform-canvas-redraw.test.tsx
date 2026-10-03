import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { WaveformCanvas } from '@/components/waveform-canvas'

/**
 * 波形を描き直すのは、描く中身が変わったときだけ（制作者 2026-10-04「setCurrentSecとsetDrawErrorでIssue出てたりする」）。
 *
 * 点の無い波形（解析は済んだが点が 0 個）では、描くたびに点の配列を新しく作っていたため、親が描き直すたびに
 * 波形も描き直し、そのたびに描けたかどうかの state を更新していた。再生中は毎フレーム親が描き直すので、
 * 開発時の `Maximum update depth exceeded` の燃料になる。
 */

const WIDTH_PX = 400

const fakeContext = (): CanvasRenderingContext2D =>
  ({
    fillStyle: '',
    clearRect: () => undefined,
    fillRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    fill: () => undefined,
  }) as unknown as CanvasRenderingContext2D

let getContext: MockInstance

beforeEach(() => {
  getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext())
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(WIDTH_PX)
  vi.stubGlobal('matchMedia', () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        // 初期値は `clientWidth` から取れている。変化は起こさない。
      }
      disconnect(): void {
        // 何もしない。
      }
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const BEATS = [1, 2, 3]
const DOWNBEATS = [1]
const NONE: readonly number[] = []

describe('波形の描き直し', () => {
  it('点の無い波形でも、親が描き直しただけでは描き直さない', async () => {
    const peaks = { status: 'empty' } as const
    const ui = () => (
      <WaveformCanvas
        peaks={peaks}
        durationSec={8}
        beats={BEATS}
        downbeats={DOWNBEATS}
        drops={NONE}
        sectionBoundarySec={NONE}
      />
    )
    const { rerender } = render(ui())
    // 最初の描画と、テーマの色を読んだあとの描き直しが落ち着くのを待つ。
    await act(async () => {
      await Promise.resolve()
    })
    const settled = getContext.mock.calls.length
    expect(settled).toBeGreaterThan(0)

    rerender(ui())
    rerender(ui())

    expect(getContext.mock.calls.length).toBe(settled)
  })
})
