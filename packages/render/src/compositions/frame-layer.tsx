import type React from 'react'
import { AbsoluteFill } from 'remotion'
import { GlitchBands, glitchBands } from '../effects/glitch.js'
import {
  IDENTITY_FRAME_LAYER,
  frameLayerAt,
  frameLayerStyle,
  isIdentityFrameLayer,
  needsFrameFilter,
  transitionGlitchStrength,
} from '../frame-effects.js'
import type { TimelinePlan } from '../plan.js'
import { FrameFilter } from './frame-filter.js'

/** `timelineLayers` を素の関数として呼ぶ（検査用）ときのフィルタの ID。 */
export const DEFAULT_FRAME_FILTER_ID = 'ixa-frame-filter'

/** 映像の矩形の外を切り落とす（`clip-path: inset`）。寄った分を黒帯へはみ出させない。 */
export const videoInset = (plan: Pick<TimelinePlan, 'canvas' | 'video'>): string => {
  const right = plan.canvas.width - plan.video.left - plan.video.width
  const bottom = plan.canvas.height - plan.video.top - plan.video.height
  return `inset(${String(plan.video.top)}px ${String(right)}px ${String(bottom)}px ${String(plan.video.left)}px)`
}

/**
 * VIDEO1・VIDEO2 の入れ物（ADR-0050）。いまのコマで効いている揺れ・寄り・whip_pan・glitch を重ねて当てる。
 * **フックを持たない**（コマは外から渡す）。null はコマに依らない組み立て（検査用）で、動かさない。
 *
 * 何も効いていないコマでは style が空で、前と同じ絵になる。暗転・テロップ・重ねるエフェクトはこの外に置くので動かない。
 */
export const FrameLayer: React.FC<{
  readonly plan: TimelinePlan
  readonly frame: number | null
  readonly filterId: string
  readonly children?: React.ReactNode
}> = ({ plan, frame, filterId, children }) => {
  const moved = frame === null ? IDENTITY_FRAME_LAYER : frameLayerAt(plan.frameMovers, frame, plan.fps)
  const still = isIdentityFrameLayer(moved)
  return (
    <>
      <AbsoluteFill style={{ zIndex: plan.frameLayerZIndex, ...(still ? {} : { clipPath: videoInset(plan) }) }}>
        <AbsoluteFill style={frameLayerStyle(moved, plan.video, filterId)}>{children}</AbsoluteFill>
      </AbsoluteFill>
      {needsFrameFilter(moved) ? <FrameFilter id={filterId} state={moved} video={plan.video} /> : null}
    </>
  )
}

/** glitch のトランジションに重ねる帯。重ねるエフェクトのグリッチと同じ部品（`GlitchBands`）で描く。 */
export const TransitionGlitchLayers: React.FC<{ readonly plan: TimelinePlan; readonly frame: number | null }> = ({
  plan,
  frame,
}) => {
  if (frame === null) return null
  return (
    <>
      {plan.frameMovers.map((mover, index) => {
        if (mover.kind !== 'glitch') return null
        const strength = transitionGlitchStrength(mover, frame)
        if (strength <= 0) return null
        return (
          // 入れ物を被せない（被せると difference が下の絵に届かない。`OverlayBox`）。
          <GlitchBands
            key={`glitch:${String(index)}`}
            name="transition_glitch"
            bands={glitchBands(strength, frame, mover.seed)}
            rgbSplit={0.012 * strength}
            video={plan.video}
            layer={{ zIndex: plan.transitionOverlayZIndex, opacity: 1 }}
          />
        )
      })}
    </>
  )
}
