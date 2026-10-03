'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { WAVEFORM_HEIGHT_PX } from '@/lib/waveform-bands'
import { fillWaveformHeight, shouldResizeWaveform } from '@/lib/waveform-fill'

/**
 * 波形の高さ。**パネルの余りをもらう**（`cut-editor.tsx` から分けた）。
 *
 * 既定の 78px 固定では、パネルを縦に広げても波形は変わらず、
 * 増えるのは下のフォームの余白だけだった。ここがこのパネルの主役なので、
 * 余ったぶんは波形に渡す。下限を切る狭さでは従来どおりスクロールで見せる。
 */
export const useWaveformFillHeight = (): {
  readonly waveBoxRef: RefObject<HTMLDivElement | null>
  readonly waveHeightPx: number
} => {
  const waveBoxRef = useRef<HTMLDivElement | null>(null)
  const [waveHeightPx, setWaveHeightPx] = useState(WAVEFORM_HEIGHT_PX)

  useEffect(() => {
    const box = waveBoxRef.current
    const body = box?.closest('[data-panel-body]')
    const content = box?.closest('[data-cut-editor]')
    if (!box || !(body instanceof HTMLElement) || !(content instanceof HTMLElement)) return undefined
    const measure = (): void => {
      // `clientHeight` は内側の余白を含む。中身が使えるのはそれを引いたぶん。
      const style = window.getComputedStyle(body)
      const padding =
        Number.parseFloat(style.paddingTop || '0') + Number.parseFloat(style.paddingBottom || '0')
      setWaveHeightPx((current) => {
        const next = fillWaveformHeight({
          bodyClientHeight: body.clientHeight - padding,
          // 入れ物ではなく中身の高さ。余裕があると scrollHeight は入れ物と同じ値になる。
          contentHeight: content.offsetHeight,
          currentHeight: current,
          // 状態ではなく画面の高さで「波形以外」を求める（Safari で 96 ↔ 416 を往復した）。
          // 波形がまだ無い（読み込み中）なら、中身に波形の高さは含まれていない。
          renderedHeight: box.querySelector<HTMLElement>('[data-waveform-body]')?.offsetHeight ?? 0,
        })
        return shouldResizeWaveform(current, next) ? next : current
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    observer.observe(content)
    return () => {
      observer.disconnect()
    }
  }, [])

  return { waveBoxRef, waveHeightPx }
}
