import {
  parseEffectParams,
  secondsToFrames,
  type ShakeParams,
  type TimelineDocument,
  type ZoomPunchParams,
} from '@ixa/domain'
import type React from 'react'
import { easeInQuad, easeOutCubic } from './effects/envelope.js'
import type { FrameContribution as Contribution, FrameLayerState } from './effects/frame-layer.js'
import { IDENTITY_FRAME_LAYER } from './effects/frame-layer.js'
import { hashSeed, randomAt, signedRandomAt } from './effects/random.js'
import { shakeAt } from './effects/shake.js'
import { zoomPunchAt } from './effects/zoom-punch.js'
import type { FitRect } from './presets.js'
import { frameRange, type FrameRange } from './timing.js'

/**
 * 下の絵（VIDEO1 と VIDEO2）そのものを動かすもの（ADR-0050）。
 * エフェクトの「揺れ」「寄りのパンチ」と、トランジションの whip_pan・glitch がここに載る。
 *
 * どれも**コマと値だけで決まる**。乱れは ID から取った種で引く（`effects/random.ts`）。
 * 暗転・テロップ・重ねるエフェクトは、この外に置くので動かない。
 */
export type FrameMover =
  | { readonly kind: 'shake'; readonly seed: number; readonly range: FrameRange; readonly params: ShakeParams }
  | { readonly kind: 'zoom_punch'; readonly range: FrameRange; readonly params: ZoomPunchParams }
  | { readonly kind: 'whip_pan'; readonly range: FrameRange; readonly boundaryFrame: number }
  | { readonly kind: 'glitch'; readonly seed: number; readonly range: FrameRange; readonly boundaryFrame: number }

/** whip_pan・glitch の尺が 0 のときの尺（秒）。重ねる素材を使わないので、尺 0 でも効果を出す。 */
export const DEFAULT_MOVING_TRANSITION_SEC = 0.4

/** whip_pan の振れ幅。寄る分（scale − 1）の半分までしか動かさないので、端に黒が出ない。 */
const WHIP_SCALE = 0.4
const WHIP_SHIFT = WHIP_SCALE / 2
const WHIP_BLUR = 0.05
const WHIP_FLASH = 0.8

const isFrameMoverKey = (key: string): boolean => key === 'shake' || key === 'zoom_punch'

const clipMovers = (doc: TimelineDocument): readonly FrameMover[] =>
  doc.clips.flatMap((clip): readonly FrameMover[] => {
    if (clip.content.type !== 'motion_graphics' || !isFrameMoverKey(clip.content.templateKey)) return []
    // 読めない値のクリップは動かさない。クリップの層に理由つきの枠が出る（Timeline.tsx）。
    const parsed = parseEffectParams(clip.content.templateKey, clip.content.params)
    if (!parsed.ok) return []
    const range = frameRange(clip.startSec, clip.durationSec, doc.fps)
    if (parsed.value.templateKey === 'shake') {
      return [{ kind: 'shake', seed: hashSeed(clip.id), range, params: parsed.value.params }]
    }
    if (parsed.value.templateKey === 'zoom_punch') return [{ kind: 'zoom_punch', range, params: parsed.value.params }]
    return []
  })

/** whip_pan・glitch は境目を中心に、前後半分ずつを使う（暗転と同じ置き方）。 */
const transitionMovers = (doc: TimelineDocument): readonly FrameMover[] =>
  doc.transitions.flatMap((transition): readonly FrameMover[] => {
    if (transition.type !== 'whip_pan' && transition.type !== 'glitch') return []
    const from = doc.video1.find((shot) => shot.shotId === transition.fromShotId)
    if (from === undefined) return []
    const durationSec = transition.durationSec > 0 ? transition.durationSec : DEFAULT_MOVING_TRANSITION_SEC
    const boundarySec = from.startSec + from.durationSec
    // 境目の前に半分ぶんの時間が無い（曲の頭のすぐ後の境目）ときは、前後とも縮めて境目を真ん中に保つ。
    // 頭だけ 0 で切ると、境目が区間の前寄りになって流れ方が左右で揃わない。
    const half = Math.min(durationSec / 2, boundarySec)
    if (half <= 0) return []
    const range = frameRange(boundarySec - half, half * 2, doc.fps)
    const boundaryFrame = secondsToFrames(boundarySec, doc.fps)
    return transition.type === 'whip_pan'
      ? [{ kind: 'whip_pan', range, boundaryFrame }]
      : [{ kind: 'glitch', seed: hashSeed(transition.id), range, boundaryFrame }]
  })

/** 文書から、絵を動かすものを並べる。 */
export const buildFrameMovers = (doc: TimelineDocument): readonly FrameMover[] => [
  ...clipMovers(doc),
  ...transitionMovers(doc),
]

const inRange = (range: FrameRange, frame: number): boolean =>
  frame >= range.from && frame < range.from + range.durationInFrames

/** 境目までの位置（-1〜1。0 が境目）。 */
const aroundBoundary = (mover: { readonly range: FrameRange; readonly boundaryFrame: number }, frame: number): number => {
  const before = Math.max(1, mover.boundaryFrame - mover.range.from)
  const after = Math.max(1, mover.range.from + mover.range.durationInFrames - mover.boundaryFrame)
  return frame < mover.boundaryFrame ? (frame - mover.boundaryFrame) / before : (frame - mover.boundaryFrame) / after
}

/** whip_pan。前の Shot は加速しながら左へ流れ、次の Shot は右から流れ込んで止まる。境目で一瞬明るくなる。 */
const whipPanAt = (mover: Extract<FrameMover, { kind: 'whip_pan' }>, frame: number): Contribution => {
  const p = aroundBoundary(mover, frame)
  const u = p < 0 ? easeInQuad(1 + p) : 1 - easeOutCubic(p)
  return {
    translateX: (p < 0 ? -1 : 1) * WHIP_SHIFT * u,
    scale: 1 + WHIP_SCALE * u,
    blurX: WHIP_BLUR * u,
    brightness: 1 + WHIP_FLASH * u * u,
  }
}

/** glitch。境目に近いほど強く、2 コマごとに跳ねて色がずれる。 */
type GlitchMover = Extract<FrameMover, { kind: 'glitch' }>

/** glitch のトランジションの強さ（0〜1）。境目で 1、範囲の端と外で 0。帯（`GlitchBands`）もこれを使う。 */
export const transitionGlitchStrength = (mover: GlitchMover, frame: number): number =>
  inRange(mover.range, frame) ? Math.sqrt(1 - Math.min(1, Math.abs(aroundBoundary(mover, frame)))) : 0

const glitchAt = (mover: GlitchMover, frame: number): Contribution => {
  const envelope = transitionGlitchStrength(mover, frame)
  const step = Math.floor(frame / 2)
  const jumps = randomAt(mover.seed, step * 3) > 0.4
  return {
    translateX: jumps ? 0.03 * envelope * signedRandomAt(mover.seed, step * 3 + 1) : 0,
    scale: 1 + 0.06 * envelope,
    rgbSplit: 0.012 * envelope * (0.5 + randomAt(mover.seed, step * 3 + 2)),
    brightness: 1 + 0.25 * envelope * randomAt(mover.seed, step * 3 + 2),
  }
}

const contributionAt = (mover: FrameMover, frame: number, fps: number): Contribution => {
  const sec = (frame - mover.range.from) / fps
  switch (mover.kind) {
    case 'shake':
      return shakeAt(mover.params, mover.seed, sec, mover.range.durationInFrames / fps, fps)
    case 'zoom_punch':
      return zoomPunchAt(mover.params, sec, mover.range.durationInFrames / fps, fps)
    case 'whip_pan':
      return whipPanAt(mover, frame)
    case 'glitch':
      return glitchAt(mover, frame)
  }
}

/**
 * 動かした分だけ寄って、映像の矩形の端（黒）を見せない。
 * 位置のずれ（幅・高さに対する割合）と傾きの両方を覆える大きさを下限にする。傾きの分は縦横比 2 まで見込む。
 * 1 つずつの型は自分の分を覆っていても、重ねると（whip_pan ＋ 揺れ）ずれが足されて覆いきれなかった。
 */
const coverTranslate = (state: FrameLayerState): FrameLayerState => {
  const rad = (Math.abs(state.rotateDeg) * Math.PI) / 180
  const shift = Math.max(Math.abs(state.translateX), Math.abs(state.translateY))
  const needed = (Math.cos(rad) + Math.sin(rad) * 2) * (1 + 2 * shift)
  return { ...state, scale: Math.max(state.scale, needed) }
}

/** 小数の端を丸める。見た目は変わらず、同じコマの値が文字列でも同じになる。 */
const round = (value: number): number => Math.round(value * 1e5) / 1e5

/**
 * あるコマで、効いているもの全部を重ねた動かし方。範囲の外では何もしない（`IDENTITY_FRAME_LAYER`）。
 * 位置・回転・ぼかし・色ずれは足し、大きさと明るさは掛ける。
 */
export const frameLayerAt = (movers: readonly FrameMover[], frame: number, fps: number): FrameLayerState => {
  const state = movers
    .filter((mover) => inRange(mover.range, frame))
    .map((mover) => contributionAt(mover, frame, fps))
    .reduce<FrameLayerState>(
      (acc, part) => ({
        translateX: acc.translateX + (part.translateX ?? 0),
        translateY: acc.translateY + (part.translateY ?? 0),
        scale: acc.scale * (part.scale ?? 1),
        rotateDeg: acc.rotateDeg + (part.rotateDeg ?? 0),
        blurX: acc.blurX + (part.blurX ?? 0),
        rgbSplit: acc.rgbSplit + (part.rgbSplit ?? 0),
        brightness: acc.brightness * (part.brightness ?? 1),
      }),
      IDENTITY_FRAME_LAYER,
    )
  const covered = coverTranslate(state)
  return {
    translateX: round(covered.translateX),
    translateY: round(state.translateY),
    scale: round(covered.scale),
    rotateDeg: round(state.rotateDeg),
    blurX: round(state.blurX),
    rgbSplit: round(state.rgbSplit),
    brightness: round(state.brightness),
  }
}

export { IDENTITY_FRAME_LAYER, type FrameLayerState }

export const isIdentityFrameLayer = (state: FrameLayerState): boolean =>
  (Object.keys(IDENTITY_FRAME_LAYER) as (keyof FrameLayerState)[]).every((key) => state[key] === IDENTITY_FRAME_LAYER[key])

/** SVG のフィルタ（ぼかし・色ずれ）が要るか。 */
export const needsFrameFilter = (state: FrameLayerState): boolean => state.blurX > 0 || state.rgbSplit > 0

/**
 * 動かし方を CSS にする。何もしないコマでは空（前と同じ絵）。
 * 中心は映像の矩形の中心。`filterId` は SVG のフィルタ（`FrameFilter`）の ID。
 */
export const frameLayerStyle = (state: FrameLayerState, video: FitRect, filterId: string): React.CSSProperties => {
  if (isIdentityFrameLayer(state)) return {}
  const x = round(state.translateX * video.width)
  const y = round(state.translateY * video.height)
  const filters = [
    ...(needsFrameFilter(state) ? [`url(#${filterId})`] : []),
    ...(state.brightness === 1 ? [] : [`brightness(${String(state.brightness)})`]),
  ]
  return {
    transform: `translate(${String(x)}px, ${String(y)}px) scale(${String(state.scale)}) rotate(${String(state.rotateDeg)}deg)`,
    transformOrigin: `${String(video.left + video.width / 2)}px ${String(video.top + video.height / 2)}px`,
    ...(filters.length === 0 ? {} : { filter: filters.join(' ') }),
  }
}
