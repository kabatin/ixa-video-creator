import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MOVING_TRANSITION_SEC,
  IDENTITY_FRAME_LAYER,
  buildFrameMovers,
  frameLayerAt,
  frameLayerStyle,
  needsFrameFilter,
} from '../frame-effects.js'
import { buildTimelinePlan } from '../plan.js'
import { letterboxFit } from '../presets.js'
import { makeClip, makeDocument, makeTransition, makeVideo1Shot, shotId } from './fixtures.js'

const FPS = 30
const VIDEO = letterboxFit({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })

const effect = (n: number, templateKey: string, startSec: number, durationSec: number, params: Record<string, unknown> = {}) =>
  makeClip(n, 'VFX', startSec, durationSec, 0, { type: 'motion_graphics', templateKey, params })

const twoShots = () => [makeVideo1Shot(1, 0, 2), makeVideo1Shot(2, 2, 2)]

/** 下の絵を動かすもの（ADR-0050）。プレビューと書き出しで同じ絵になるよう、コマと値だけで決まること。 */
describe('frameLayerAt — 揺れ・寄りのパンチ', () => {
  const doc = makeDocument({ clips: [effect(1, 'shake', 1, 1, { intensity: 1 }), effect(2, 'zoom_punch', 3, 1, { scale: 1.3, peakAtSec: 0.2 })] })
  const movers = buildFrameMovers(doc)

  it('範囲の外では何もしない', () => {
    for (const frame of [0, 29, 60, 89, 120, 200]) expect(frameLayerAt(movers, frame, FPS)).toEqual(IDENTITY_FRAME_LAYER)
  })

  it('範囲の中では動く', () => {
    expect(frameLayerAt(movers, 35, FPS)).not.toEqual(IDENTITY_FRAME_LAYER)
    expect(frameLayerAt(movers, 96, FPS).scale).toBe(1.3)
  })

  it('同じコマ・同じ値なら同じ動かし方（決まった乱数）', () => {
    for (const frame of [31, 40, 52, 95, 100]) {
      expect(frameLayerAt(buildFrameMovers(doc), frame, FPS)).toEqual(frameLayerAt(movers, frame, FPS))
      expect(frameLayerStyle(frameLayerAt(movers, frame, FPS), VIDEO, 'f')).toEqual(
        frameLayerStyle(frameLayerAt(buildFrameMovers(doc), frame, FPS), VIDEO, 'f'),
      )
    }
  })

  it('揺れの乱れはクリップごとに違う（ID が種）', () => {
    const other = buildFrameMovers(makeDocument({ clips: [effect(7, 'shake', 1, 1, { intensity: 1 })] }))
    expect(frameLayerAt(other, 40, FPS)).not.toEqual(frameLayerAt(movers, 40, FPS))
  })

  it('揺れは揺れた分だけ寄って、端に黒を見せない', () => {
    for (let frame = 30; frame < 60; frame += 1) {
      const state = frameLayerAt(movers, frame, FPS)
      const cover = (state.scale - 1) / 2
      expect(Math.abs(state.translateX)).toBeLessThanOrEqual(cover + 1e-4)
      expect(Math.abs(state.translateY)).toBeLessThanOrEqual(cover + 1e-4)
    }
  })

  it('寄りのパンチは寄りきってから戻る', () => {
    const peak = frameLayerAt(movers, 96, FPS).scale
    expect(frameLayerAt(movers, 92, FPS).scale).toBeLessThan(peak)
    expect(frameLayerAt(movers, 105, FPS).scale).toBeLessThan(peak)
    expect(frameLayerAt(movers, 119, FPS).scale).toBeCloseTo(1, 2)
  })

  it('読めない値のクリップは動かさない（クリップの層に枠が出る）', () => {
    expect(buildFrameMovers(makeDocument({ clips: [effect(1, 'shake', 0, 1, { intensity: 5 })] }))).toEqual([])
  })

  it('重ねるエフェクトは下の絵を動かさない', () => {
    expect(buildFrameMovers(makeDocument({ clips: [effect(1, 'flash', 0, 1)] }))).toEqual([])
  })

  it('同時に効くものは重ねる（大きさは掛ける）', () => {
    const both = buildFrameMovers(
      makeDocument({ clips: [effect(1, 'zoom_punch', 0, 1, { scale: 1.2 }), effect(2, 'zoom_punch', 0, 1, { scale: 1.1 })] }),
    )
    expect(frameLayerAt(both, 0, FPS).scale).toBeCloseTo(1.32, 4)
  })
})

describe('frameLayerAt — スピード線の周りのぼかし', () => {
  const movers = (direction: 'radial' | 'horizontal') =>
    buildFrameMovers(makeDocument({ clips: [effect(1, 'speed_lines', 1, 1, { direction, intensity: 1 })] }))

  it('放射は全方向、横は横向きにぼかす。絵は動かさない', () => {
    const radial = frameLayerAt(movers('radial'), 45, FPS)
    expect(radial.edgeBlur).toBeGreaterThan(0)
    expect(radial.edgeBlurX).toBe(0)
    const horizontal = frameLayerAt(movers('horizontal'), 45, FPS)
    expect(horizontal.edgeBlurX).toBeGreaterThan(0)
    expect(horizontal.edgeBlur).toBe(0)
    expect(needsFrameFilter(horizontal)).toBe(true)
    expect({ ...horizontal, edgeBlurX: 0 }).toEqual(IDENTITY_FRAME_LAYER)
  })

  it('範囲の外と、頭と尻のコマではぼかさない', () => {
    for (const frame of [0, 29, 60, 90]) expect(frameLayerAt(movers('radial'), frame, FPS)).toEqual(IDENTITY_FRAME_LAYER)
  })
})

describe('frameLayerAt — whip_pan と glitch のトランジション', () => {
  const doc = (type: 'whip_pan' | 'glitch', durationSec = 0.4) =>
    makeDocument({ video1: twoShots(), transitions: [makeTransition(1, shotId(1), shotId(2), type, durationSec)] })

  it('境目を中心に前後半分ずつ効く', () => {
    const [mover] = buildFrameMovers(doc('whip_pan'))
    expect(mover?.range).toEqual({ from: 54, durationInFrames: 12 })
  })

  it('尺 0 でも既定の尺で効く（重ねる素材を使わない）', () => {
    const [mover] = buildFrameMovers(doc('whip_pan', 0))
    expect(mover?.range.durationInFrames).toBe(Math.round(DEFAULT_MOVING_TRANSITION_SEC * FPS))
  })

  it('whip_pan は前の Shot が左へ、次の Shot が右から流れ込み、横にぼけて明るくなる', () => {
    const movers = buildFrameMovers(doc('whip_pan'))
    const before = frameLayerAt(movers, 59, FPS)
    const after = frameLayerAt(movers, 60, FPS)
    expect(before.translateX).toBeLessThan(0)
    expect(after.translateX).toBeGreaterThan(0)
    expect(after.blurX).toBeGreaterThan(0)
    expect(after.brightness).toBeGreaterThan(1)
    expect(needsFrameFilter(after)).toBe(true)
    // 流した分は寄った分の半分以内（端に黒が出ない）。
    expect(Math.abs(after.translateX)).toBeLessThanOrEqual((after.scale - 1) / 2 + 1e-4)
    expect(frameLayerAt(movers, 53, FPS)).toEqual(IDENTITY_FRAME_LAYER)
    expect(frameLayerAt(movers, 66, FPS)).toEqual(IDENTITY_FRAME_LAYER)
  })

  it('glitch は境目で色がずれ、同じコマなら同じ乱れ', () => {
    const movers = buildFrameMovers(doc('glitch'))
    expect(frameLayerAt(movers, 60, FPS).rgbSplit).toBeGreaterThan(0)
    expect(frameLayerAt(buildFrameMovers(doc('glitch')), 61, FPS)).toEqual(frameLayerAt(movers, 61, FPS))
  })

  it('wipe は動かさない（まだ cut に縮退する）', () => {
    const wipe = makeDocument({ video1: twoShots(), transitions: [makeTransition(1, shotId(1), shotId(2), 'wipe', 0.4)] })
    expect(buildFrameMovers(wipe)).toEqual([])
    expect(buildTimelinePlan(wipe, { width: 1920, height: 1080 }).degradedTransitions).toHaveLength(1)
  })
})

describe('frameLayerStyle', () => {
  it('何もしないコマでは空（前と同じ絵）', () => {
    expect(frameLayerStyle(IDENTITY_FRAME_LAYER, VIDEO, 'f')).toEqual({})
  })

  it('動かすコマでは映像の中心を軸に変形し、ぼかし・色ずれは SVG のフィルタを指す', () => {
    const style = frameLayerStyle({ ...IDENTITY_FRAME_LAYER, translateX: 0.1, scale: 1.2, blurX: 0.01, brightness: 1.5 }, VIDEO, 'f1')
    expect(style.transform).toBe('translate(192px, 0px) scale(1.2) rotate(0deg)')
    expect(style.transformOrigin).toBe('960px 540px')
    expect(style.filter).toBe('url(#f1) brightness(1.5)')
  })
})

/** 2026-10-17 のレビューで見つかった跳ね・黒い端・ずれ。 */
describe('frameLayerAt — 終わりで戻りきる・端を見せない・境目を真ん中に', () => {
  it('寄りのパンチは戻るまでが尺より長くても、最後のコマで元の大きさに戻る', () => {
    const movers = buildFrameMovers(makeDocument({ clips: [effect(1, 'zoom_punch', 0, 0.5, { scale: 1.4, peakAtSec: 0.2, decaySec: 3 })] }))
    const last = Math.round(0.5 * FPS) - 1
    expect(frameLayerAt(movers, last, FPS)).toEqual(IDENTITY_FRAME_LAYER)
    expect(frameLayerAt(movers, last - 3, FPS).scale).toBeGreaterThan(1)
  })

  it('揺れも最後のコマで止まりきる', () => {
    const movers = buildFrameMovers(makeDocument({ clips: [effect(1, 'shake', 0, 0.5, { intensity: 1 })] }))
    expect(frameLayerAt(movers, Math.round(0.5 * FPS) - 1, FPS)).toEqual(IDENTITY_FRAME_LAYER)
  })

  it.each([
    ['揺れだけ（傾きの分）', [], 0, 60],
    ['whip_pan と揺れ', [makeTransition(1, shotId(1), shotId(2), 'whip_pan', 0.4)], 54, 66],
    ['glitch と揺れ', [makeTransition(1, shotId(1), shotId(2), 'glitch', 0.4)], 54, 66],
  ] as const)('%s を重ねても、ずれと傾きを覆える大きさまで寄る（端の黒を見せない）', (_name, transitions, from, to) => {
    const shakeAt = from / FPS
    const movers = buildFrameMovers(
      makeDocument({ video1: twoShots(), transitions: [...transitions], clips: [effect(1, 'shake', shakeAt, 2, { intensity: 1, frequencyHz: 30 })] }),
    )
    for (let frame = from; frame < to; frame += 1) {
      const s = frameLayerAt(movers, frame, FPS)
      const rad = (Math.abs(s.rotateDeg) * Math.PI) / 180
      const cover = (s.scale / (Math.cos(rad) + Math.sin(rad) * 2) - 1) / 2
      expect(Math.max(Math.abs(s.translateX), Math.abs(s.translateY))).toBeLessThanOrEqual(cover + 1e-4)
    }
  })

  it('境目の前に半分の時間が無ければ、前後とも縮めて境目を真ん中に保つ', () => {
    const doc = makeDocument({
      video1: [makeVideo1Shot(1, 0, 0.1), makeVideo1Shot(2, 0.1, 2)],
      transitions: [makeTransition(1, shotId(1), shotId(2), 'whip_pan', 0.4)],
    })
    const [mover] = buildFrameMovers(doc)
    expect(mover?.range).toEqual({ from: 0, durationInFrames: 6 })
    expect(mover?.kind === 'whip_pan' && mover.boundaryFrame).toBe(3)
  })
})
