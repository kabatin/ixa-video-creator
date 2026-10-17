import { EffectTemplateKey, defaultEffectParams, parseEffectParams, type EffectContent } from '@ixa/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ClipBody } from '../compositions/Timeline.js'
import { effectTimeAt } from '../effects/envelope.js'
import { flashOpacity } from '../effects/flash.js'
import { EffectOverlay, resolveEffectClip } from '../effects/index.js'
import { hashSeed } from '../effects/random.js'
import { speedLines } from '../effects/speed-lines.js'
import { titleCardMotion } from '../effects/title-card.js'
import { buildTimelinePlan, type ClipPlan } from '../plan.js'
import { letterboxFit } from '../presets.js'
import { makeClip, makeDocument } from './fixtures.js'

const FPS = 30
const CANVAS = { width: 1920, height: 1080 }
const VIDEO = letterboxFit({ width: 1920, height: 1080 }, CANVAS)

const contentOf = (key: string, params: Record<string, unknown> = {}): EffectContent => {
  const parsed = parseEffectParams(key, params)
  if (!parsed.ok) throw new Error(parsed.message)
  return parsed.value
}

const overlayMarkup = (content: EffectContent, frame: number, seedText = 'clip-a'): string =>
  renderToStaticMarkup(
    <EffectOverlay content={content} time={effectTimeAt(frame, 30, FPS)} video={VIDEO} seed={hashSeed(seedText)} />,
  )

const planFor = (content: Record<string, unknown>): ClipPlan => {
  const clip = makeClip(1, 'VFX', 0, 1, 0, { type: 'motion_graphics', templateKey: String(content.templateKey), params: content.params as Record<string, unknown> })
  const [first] = buildTimelinePlan(makeDocument({ clips: [clip] }), CANVAS).clips
  if (first === undefined) throw new Error('clip plan が空です')
  return first
}

const OVERLAY_KEYS = EffectTemplateKey.options.filter((key) => key !== 'shake' && key !== 'zoom_punch')

/** 重ねるエフェクト（ADR-0050）。Player と renderMedia が同じ絵を描くよう、コマと値と種だけで決まること。 */
describe('EffectOverlay', () => {
  it.each(OVERLAY_KEYS)('%s は同じコマ・同じ値・同じ種なら同じ絵', (key) => {
    const content = contentOf(key, defaultEffectParams(key))
    for (const frame of [0, 3, 9, 20]) expect(overlayMarkup(content, frame)).toBe(overlayMarkup(content, frame))
    expect(overlayMarkup(content, 5)).toContain(`data-effect="${key}"`)
  })

  it.each(OVERLAY_KEYS)('%s はコマが進むと絵が変わる（止まった絵ではない）', (key) => {
    const content = contentOf(key, defaultEffectParams(key))
    const frames = [1, 4, 8, 14, 22].map((frame) => overlayMarkup(content, frame))
    expect(new Set(frames).size).toBeGreaterThan(1)
  })

  it('タイトルカードは文字を出す', () => {
    const markup = overlayMarkup(contentOf('title_card', { text: '曲のドロップ', subtext: 'iXA CUP' }), 10)
    expect(markup).toContain('曲のドロップ')
    expect(markup).toContain('iXA CUP')
  })

  it('スピード線は種が違えば線の位置が違う', () => {
    const params = { density: 0.5, intensity: 0.7, direction: 'radial' } as const
    expect(speedLines(params, 4, 1920, 1080, 1)).toEqual(speedLines(params, 4, 1920, 1080, 1))
    expect(speedLines(params, 4, 1920, 1080, 2)).not.toEqual(speedLines(params, 4, 1920, 1080, 1))
  })

  it('フラッシュは立ち上がって消え、消えた後は出ない', () => {
    const params = { color: '#ffffff', intensity: 1, attackSec: 0.1, decaySec: 0.2 }
    expect(flashOpacity(params, 0)).toBe(0)
    expect(flashOpacity(params, 0.1)).toBe(1)
    expect(flashOpacity(params, 0.2)).toBeGreaterThan(0)
    expect(flashOpacity(params, 0.31)).toBe(0)
  })

  it('タイトルの叩きつけは大きく出て縮んで止まり、終わりで消える', () => {
    const params = contentOf('title_card', { entrance: 'punch' })
    if (params.templateKey !== 'title_card') throw new Error('unreachable')
    expect(titleCardMotion(params.params, 0, 2).scale).toBe(1.6)
    expect(titleCardMotion(params.params, 0.5, 2)).toEqual({ opacity: 1, scale: 1, offsetY: 0 })
    expect(titleCardMotion(params.params, 2, 2).opacity).toBe(0)
  })
})

describe('ClipBody — エフェクトのクリップ', () => {
  it('揺れ・寄りのパンチはクリップの層には何も描かない（下の絵を動かす）', () => {
    expect(resolveEffectClip({ templateKey: 'shake', params: {} })).toEqual({ status: 'frame' })
    const markup = renderToStaticMarkup(<ClipBody clip={planFor({ templateKey: 'zoom_punch', params: {} })} fps={FPS} video={VIDEO} />)
    expect(markup).toBe('')
  })

  it('知らない型は枠と理由を出す（無言で消さない）', () => {
    const markup = renderToStaticMarkup(<ClipBody clip={planFor({ templateKey: 'ink_splash', params: {} })} fps={FPS} video={VIDEO} />)
    expect(markup).toContain('[motion_graphics] ink_splash')
    expect(markup).toContain('知らないエフェクトの型')
  })

  it('範囲外の値は枠と理由を出す', () => {
    const markup = renderToStaticMarkup(<ClipBody clip={planFor({ templateKey: 'flash', params: { intensity: 3 } })} fps={FPS} video={VIDEO} />)
    expect(markup).toContain('[motion_graphics] flash')
    expect(markup).toContain('強さは 0〜1')
  })
})
