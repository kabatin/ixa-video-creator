import type React from 'react'
import type { FrameLayerState } from '../effects/frame-layer.js'
import type { FitRect } from '../presets.js'

/** 赤・緑・青を 1 色ずつ取り出す行列。 */
const CHANNEL = {
  r: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
  g: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
  b: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
} as const

const round = (value: number): number => Math.round(value * 100) / 100

/**
 * ぼかしの上限（1080 の高さで 24px 相当）。whip_pan の頂点で幅の 5% をそのまま当てると Player で重かった。
 * 上限は映像の高さに比べて決めるので、出力の大きさが違っても同じ見た目になる。
 */
export const MAX_BLUR_AT_1080 = 24
export const frameBlurPx = (blurX: number, video: FitRect): number =>
  round(Math.min(blurX * video.width, (MAX_BLUR_AT_1080 * video.height) / 1080))

/**
 * 周りのぼかしの覆い（白いところだけぼかした絵が出る）。中央の楕円は空け、端へ向かって濃くする。
 * フィルタの中では gradient を作れないので、画像（SVG の data URI）として読み込む。
 */
export const EDGE_MASK_HREF =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">' +
      '<defs><radialGradient id="m" cx="50" cy="50" r="71" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0.42" stop-color="#fff" stop-opacity="0"/><stop offset="0.8" stop-color="#fff" stop-opacity="1"/>' +
      '</radialGradient></defs><rect width="100" height="100" fill="url(#m)"/></svg>',
  )

/**
 * 下の絵に当てる SVG のフィルタ（ADR-0050）。横向きのぼかし（whip_pan）と、赤と青を左右へずらす色ずれ（glitch）、周りだけのぼかし（speed_lines）。
 * CSS の `blur()` は向きを持てず、色ずれも作れないので SVG で書く。値はコマごとに渡す（`frameLayerAt`）。
 */
export const FrameFilter: React.FC<{ readonly id: string; readonly state: FrameLayerState; readonly video: FitRect }> = ({
  id,
  state,
  video,
}) => {
  const blur = frameBlurPx(state.blurX, video)
  const split = round(state.rgbSplit * video.width)
  const edgeX = round((state.edgeBlur + state.edgeBlurX) * video.height)
  const edgeY = round(state.edgeBlur * video.height)
  const hasEdge = edgeX > 0
  const base = blur > 0 ? 'blurred' : 'SourceGraphic'
  const source = hasEdge ? 'edged' : base
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <filter id={id} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          {blur > 0 ? <feGaussianBlur in="SourceGraphic" stdDeviation={`${String(blur)} 0`} result="blurred" /> : null}
          {hasEdge ? (
            <>
              <feGaussianBlur in={base} stdDeviation={`${String(edgeX)} ${String(edgeY)}`} edgeMode="duplicate" result="edgeBlurred" />
              <feImage
                href={EDGE_MASK_HREF}
                x={video.left}
                y={video.top}
                width={video.width}
                height={video.height}
                preserveAspectRatio="none"
                result="edgeMask"
              />
              <feComposite in="edgeBlurred" in2="edgeMask" operator="in" result="edgeOnly" />
              <feMerge result="edged">
                <feMergeNode in={base} />
                <feMergeNode in="edgeOnly" />
              </feMerge>
            </>
          ) : null}
          {split > 0 ? (
            <>
              <feColorMatrix in={source} type="matrix" values={CHANNEL.r} result="red" />
              <feOffset in="red" dx={-split} dy={0} result="redShifted" />
              <feColorMatrix in={source} type="matrix" values={CHANNEL.g} result="green" />
              <feColorMatrix in={source} type="matrix" values={CHANNEL.b} result="blue" />
              <feOffset in="blue" dx={split} dy={0} result="blueShifted" />
              <feBlend in="redShifted" in2="green" mode="screen" result="redGreen" />
              <feBlend in="redGreen" in2="blueShifted" mode="screen" />
            </>
          ) : null}
        </filter>
      </defs>
    </svg>
  )
}
