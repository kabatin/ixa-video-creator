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
  /** クリップの重なり順と不透明度。**混ぜ方（screen など）を当てる要素そのものに付ける**（`OverlayBox`）。 */
  readonly layer: ClipLayer
}

export type ClipLayer = { readonly zIndex: number; readonly opacity: number }

/**
 * 映像の矩形に収めて描く。黒帯（レターボックス）には出さない。
 *
 * **重なり順・不透明度・混ぜ方はこの要素 1 つにまとめる。** 外に zIndex や opacity の入れ物を被せると
 * そこが重なりの基準（stacking context）になり、`mix-blend-mode` が透明な入れ物とだけ混ざって
 * 下の絵に届かない（光漏れの screen が効かず、ただ濁った。2026-10-17 のレビュー）。
 * この要素が根の重なりの中にいれば、混ぜ方は下の Shot と混ざる。
 */
export const OverlayBox: React.FC<{
  readonly video: FitRect
  readonly layer: ClipLayer
  readonly blend?: React.CSSProperties['mixBlendMode']
  readonly style?: React.CSSProperties
  readonly children?: React.ReactNode
  readonly name: string
}> = ({ video, layer, blend, style, children, name }) => {
  const ownOpacity = typeof style?.opacity === 'number' ? style.opacity : 1
  return (
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
        zIndex: layer.zIndex,
        opacity: r4(ownOpacity * layer.opacity),
        ...(blend === undefined ? {} : { mixBlendMode: blend }),
      }}
    >
      {children}
    </div>
  )
}

/** 小数の端を丸める（同じコマの style が文字列でも同じになる）。 */
export const r4 = (value: number): number => Math.round(value * 1e4) / 1e4
