import type { GlitchParams } from '@ixa/domain'
import type React from 'react'
import type { FitRect } from '../presets.js'
import { fadeInOut } from './envelope.js'
import { OverlayBox, r4, type ClipLayer, type OverlayProps } from './overlay-box.js'
import { randomAt } from './random.js'

/** 2 コマごとに乱れを引き直す。 */
const GLITCH_STEP_FRAMES = 2
const MAX_BANDS = 11

export type GlitchBand = {
  /** 映像の高さに対する割合。 */
  readonly top: number
  readonly height: number
  /** 帯の左右のずれ（映像の幅に対する割合）。 */
  readonly shift: number
  /** 下の絵の色を反転させる帯か（そうでなければ赤と青の縁取りの帯）。 */
  readonly invert: boolean
}

/**
 * グリッチの帯（ADR-0050）。強さ（0〜1）が大きいほど帯が増え、ずれも大きい。
 * **重ねるエフェクトの「グリッチ」と、トランジションの glitch の両方がこれを使う。**
 */
export const glitchBands = (strength: number, frame: number, seed: number): readonly GlitchBand[] => {
  if (strength <= 0) return []
  const step = Math.floor(frame / GLITCH_STEP_FRAMES)
  const at = (i: number, k: number): number => randomAt(seed, (step * MAX_BANDS + i) * 5 + k)
  const count = Math.round(2 + (MAX_BANDS - 2) * strength)
  return Array.from({ length: count }, (_, i) => ({
    top: r4(at(i, 0)),
    height: r4(0.01 + 0.07 * at(i, 1) * strength),
    shift: r4((at(i, 2) * 2 - 1) * 0.08 * strength),
    invert: at(i, 3) < 0.3,
  }))
}

/**
 * 帯を描く部品。`rgbSplit` は赤と青の縁取りのずれ（映像の幅に対する割合）。
 *
 * 全体を `difference` で下の絵と混ぜる。白い帯は下の絵の色を反転し、赤・青の縁取りは色をずらす。
 * **`backdrop-filter` は使わない。** クリップの不透明度が 1 未満だと入れ物が背景の基準になり、反転の帯が消えた。
 */
export const GlitchBands: React.FC<{
  readonly bands: readonly GlitchBand[]
  readonly rgbSplit: number
  readonly video: FitRect
  readonly name: string
  readonly layer: ClipLayer
}> = ({ bands, rgbSplit, video, name, layer }) => {
  const split = r4(rgbSplit * video.width)
  return (
    <OverlayBox name={name} video={video} layer={layer} blend="difference">
      {bands.map((band, i) => {
        const base: React.CSSProperties = {
          position: 'absolute',
          left: r4(band.shift * video.width),
          width: video.width,
          top: r4(band.top * video.height),
          height: Math.max(1, r4(band.height * video.height)),
        }
        return band.invert ? (
          <div key={i} data-glitch-band="invert" style={{ ...base, backgroundColor: '#ffffff' }} />
        ) : (
          <div
            key={i}
            data-glitch-band="split"
            style={{
              ...base,
              boxShadow: `${String(-split)}px 0 0 rgba(255, 0, 60, 0.75), ${String(split)}px 0 0 rgba(0, 220, 255, 0.75)`,
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
            }}
          />
        )
      })}
    </OverlayBox>
  )
}

/** 重ねるエフェクトのグリッチの強さ。ところどころ乱れが止まる（止まらないと単調になる）。 */
export const glitchStrength = (params: GlitchParams, time: { readonly sec: number; readonly durationSec: number; readonly frame: number }, seed: number): number => {
  const step = Math.floor(time.frame / GLITCH_STEP_FRAMES)
  const resting = randomAt(seed, 99_000 + step) < 0.25
  return resting ? 0 : r4(params.intensity * fadeInOut(time.sec, time.durationSec, 0.1))
}

export const Glitch: React.FC<OverlayProps<GlitchParams>> = ({ params, time, video, seed, layer }) => {
  const strength = glitchStrength(params, time, seed)
  return (
    <GlitchBands
      name="glitch"
      bands={glitchBands(strength, time.frame, seed)}
      rgbSplit={0.015 * params.rgbSplit * strength}
      video={video}
      layer={layer}
    />
  )
}
