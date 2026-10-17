import { effectTemplateOf, parseEffectParams, type EffectContent } from '@ixa/domain'
import type React from 'react'
import { useCurrentFrame } from 'remotion'
import type { FitRect } from '../presets.js'
import type { ClipLayer } from './overlay-box.js'
import { effectTimeAt, type EffectTime } from './envelope.js'
import { FilmBurn } from './film-burn.js'
import { Flash } from './flash.js'
import { Glitch } from './glitch.js'
import { LightLeak } from './light-leak.js'
import { hashSeed } from './random.js'
import { SpeedLines } from './speed-lines.js'
import { TitleCard } from './title-card.js'

/**
 * エフェクトの型 → 描く部品（ADR-0050）。
 *
 * `frame` の型（揺れ・寄りのパンチ）はクリップの層には何も描かない。下の絵の動かし方は
 * `frame-effects.ts` が決め、Timeline.tsx が VIDEO1・VIDEO2 の入れ物に当てる。
 */
export type EffectClipResolution =
  | { readonly status: 'overlay'; readonly content: EffectContent }
  | { readonly status: 'frame' }
  | { readonly status: 'invalid'; readonly reason: string }

/** クリップの中身を読む。読めない（知らない型・範囲外の値）ときは理由を返し、描く側が枠を出す。 */
export const resolveEffectClip = (content: { readonly templateKey: string; readonly params: unknown }): EffectClipResolution => {
  const parsed = parseEffectParams(content.templateKey, content.params)
  if (!parsed.ok) return { status: 'invalid', reason: parsed.message }
  return effectTemplateOf(parsed.value.templateKey).kind === 'frame'
    ? { status: 'frame' }
    : { status: 'overlay', content: parsed.value }
}

/** 重ねるエフェクト 1 つ。**フックを持たない**ので、テストから同じコマを何度でも描ける。 */
export const EffectOverlay: React.FC<{
  readonly content: EffectContent
  readonly time: EffectTime
  readonly video: FitRect
  readonly seed: number
  readonly layer: ClipLayer
}> = ({ content, time, video, seed, layer }) => {
  const common = { time, video, seed, layer }
  switch (content.templateKey) {
    case 'flash':
      return <Flash params={content.params} {...common} />
    case 'light_leak':
      return <LightLeak params={content.params} {...common} />
    case 'speed_lines':
      return <SpeedLines params={content.params} {...common} />
    case 'film_burn':
      return <FilmBurn params={content.params} {...common} />
    case 'glitch':
      return <Glitch params={content.params} {...common} />
    case 'title_card':
      return <TitleCard params={content.params} {...common} />
    case 'shake':
    case 'zoom_punch':
      return null
  }
}

/** `<Sequence>` の中で使う。いまのコマ（クリップの頭から）を読んで `EffectOverlay` に渡す。 */
export const EffectClipLayer: React.FC<{
  readonly content: EffectContent
  readonly clipId: string
  readonly durationInFrames: number
  readonly fps: number
  readonly video: FitRect
  readonly layer: ClipLayer
}> = ({ content, clipId, durationInFrames, fps, video, layer }) => {
  const frame = useCurrentFrame()
  return (
    <EffectOverlay
      content={content}
      time={effectTimeAt(frame, durationInFrames, fps)}
      video={video}
      seed={hashSeed(clipId)}
      layer={layer}
    />
  )
}
