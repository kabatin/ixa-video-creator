import type React from 'react'
import type { FitRect } from '../presets.js'
import type { EffectTime } from './envelope.js'

/**
 * 重ねるエフェクトの部品が受け取るもの（ADR-0050）。**フックを持たない。**
 * コマ（`time`）は外から渡すので、テストから同じコマを何度でも描いて比べられる。
 */
export type OverlayProps<P> = {
  readonly params: P
  readonly time: EffectTime
  readonly video: FitRect
  /** 乱れの種（クリップの ID から取る）。 */
  readonly seed: number
}

/** 映像の矩形に収めて描く。黒帯（レターボックス）には出さない。 */
export const OverlayBox: React.FC<{
  readonly video: FitRect
  readonly style?: React.CSSProperties
  readonly children?: React.ReactNode
  readonly name: string
}> = ({ video, style, children, name }) => (
  <div
    data-effect={name}
    style={{
      position: 'absolute',
      left: video.left,
      top: video.top,
      width: video.width,
      height: video.height,
      overflow: 'hidden',
      pointerEvents: 'none',
      ...style,
    }}
  >
    {children}
  </div>
)

/** 小数の端を丸める（同じコマの style が文字列でも同じになる）。 */
export const r4 = (value: number): number => Math.round(value * 1e4) / 1e4
