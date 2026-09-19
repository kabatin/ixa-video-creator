import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WaveformCanvas } from '@/components/waveform-canvas'
import { THEME_ATTRIBUTE } from '@/lib/theme'
import { DEFAULT_WAVEFORM_PALETTE, WAVEFORM_COLOR_TOKENS } from '@/lib/waveform-draw'

/**
 * 波形の色がテーマに追随すること（PHASE 5.9 / P59-4）。
 *
 * **canvas には CSS のクラスが効かない。** 塗りの色はコードが持つしかないので、
 * 16 進値を直接書くとテーマを切り替えたときにそこだけ取り残される。
 * 描く直前に CSS 変数から読み、`<html data-theme>` の変化で描き直すことを、
 * 実際に塗った色を記録して固定する。
 *
 * **最初の描画では `document` を読まない**（サーバに `document` は無い。lessons L-019）。
 * そのため塗りの記録は「1 回目が既定、2 回目以降がテーマの色」になる。
 * 最終状態だけを見るとこの並びが崩れても気づけないので、**1 回目の値も固定する**。
 */

const WIDTH_PX = 400

type Recorder = { readonly fills: string[] }

/**
 * 塗った色だけを書き留める偽の 2d コンテキスト。
 * jsdom の canvas は `getContext` が `null` を返すため、描画そのものが起きない。
 */
const fakeContext = (recorder: Recorder): CanvasRenderingContext2D => {
  const ctx = {
    fillStyle: '',
    clearRect: () => undefined,
    fillRect: () => {
      recorder.fills.push(ctx.fillStyle)
    },
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    fill: () => {
      recorder.fills.push(ctx.fillStyle)
    },
  }
  return ctx as unknown as CanvasRenderingContext2D
}

const setToken = (token: string, rgb: string): void => {
  document.documentElement.style.setProperty(`--${token}`, rgb)
}

const renderCanvas = () =>
  render(
    <WaveformCanvas
      peaks={{ status: 'ok', peaks: [0.2, 0.9, 0.4], bands: null }}
      durationSec={8}
      beats={[1, 2, 3, 4]}
      downbeats={[1, 5]}
      drops={[4]}
      sectionBoundarySec={[2]}
    />,
  )

let recorder: Recorder

beforeEach(() => {
  recorder = { fills: [] }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() =>
    fakeContext(recorder),
  )
  // 幅が 0 だと目印を 1 本も選ばないので、実寸と `ResizeObserver` を用意する。
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(WIDTH_PX)
  // 端末の解像度を見張る部分。jsdom に `matchMedia` が無いので、変化しない口だけ置く。
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
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
})

describe('波形の色', () => {
  it('トークンを読めないときは既定のダークで描く', async () => {
    renderCanvas()

    await waitFor(() => {
      expect(recorder.fills.length).toBeGreaterThan(0)
    })
    expect(recorder.fills).toContain(DEFAULT_WAVEFORM_PALETTE.background)
    expect(recorder.fills).toContain(DEFAULT_WAVEFORM_PALETTE.marker.drop)
  })

  it('描く直前に CSS 変数から読む', async () => {
    setToken(WAVEFORM_COLOR_TOKENS.background, '1 2 3')
    setToken(WAVEFORM_COLOR_TOKENS.marker.drop, '4 5 6')

    renderCanvas()

    await waitFor(() => {
      expect(recorder.fills).toContain('rgb(1 2 3)')
    })
    expect(recorder.fills).toContain('rgb(4 5 6)')
  })

  it('最初の描画では document を読まない（lessons L-019）', async () => {
    /*
     * 初回に読むかどうかは、**読んだ時点で木が DOM に載っているか**で分かる。
     * 描画の最中（`useState` の初期値など）なら canvas はまだ置かれていない。
     * サーバには `document` が無いので、そこで読むと必ず食い違う。
     */
    const real = window.getComputedStyle.bind(window)
    let mountedAtFirstRead: boolean | null = null
    vi.stubGlobal('getComputedStyle', (element: Element) => {
      mountedAtFirstRead ??= document.querySelector('canvas') !== null
      return real(element)
    })

    setToken(WAVEFORM_COLOR_TOKENS.background, '1 2 3')
    renderCanvas()

    await waitFor(() => {
      expect(recorder.fills).toContain('rgb(1 2 3)')
    })
    expect(mountedAtFirstRead).toBe(true)
  })

  it('テーマを切り替えると描き直す', async () => {
    setToken(WAVEFORM_COLOR_TOKENS.marker.downbeat, '10 10 10')
    renderCanvas()
    await waitFor(() => {
      expect(recorder.fills).toContain('rgb(10 10 10)')
    })

    recorder.fills.length = 0
    setToken(WAVEFORM_COLOR_TOKENS.marker.downbeat, '250 250 250')
    document.documentElement.setAttribute(THEME_ATTRIBUTE, 'light')

    await waitFor(() => {
      expect(recorder.fills).toContain('rgb(250 250 250)')
    })
  })

  it('3 帯域の色を CSS 変数から読み、透かして塗る（PHASE 8.1）', async () => {
    setToken(WAVEFORM_COLOR_TOKENS.bands.low, '11 12 13')
    render(
      <WaveformCanvas
        peaks={{
          status: 'ok',
          peaks: [0.2, 0.9, 0.4],
          bands: { rms: [0.2, 0.9, 0.4], low: [0, 1, 0.5], mid: [0.3, 0.2, 0.1], high: [0.1, 0.1, 0.9] },
        }}
        durationSec={8}
        beats={[]}
        downbeats={[]}
        drops={[]}
        sectionBoundarySec={[]}
      />,
    )

    await waitFor(() => {
      expect(recorder.fills.some((fill) => fill.startsWith('rgb(11 12 13 / '))).toBe(true)
    })
  })

  it('波形の塗りは透かす（目印の線が波形に埋もれない）', async () => {
    setToken(WAVEFORM_COLOR_TOKENS.wave, '7 8 9')
    renderCanvas()

    await waitFor(() => {
      expect(recorder.fills.some((fill) => fill.startsWith('rgb(7 8 9 / '))).toBe(true)
    })
  })
})
