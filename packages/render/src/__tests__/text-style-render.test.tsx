import type { RenderableClipContent } from '@ixa/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ClipBody } from '../compositions/Timeline.js'
import { textFadeOpacity } from '../compositions/text-clip.js'
import { buildTimelinePlan } from '../plan.js'
import { letterboxFit } from '../presets.js'
import { makeClip, makeDocument } from './fixtures.js'

/**
 * テロップの見た目（ADR-0028）。型の既定値に `params.style` を重ねて描く。
 * ここは出力の HTML と計算を見る。画素は `text-clip-pixels.test.ts`。
 */
const CANVAS = { width: 1920, height: 1080 }
const VIDEO = letterboxFit({ width: 1920, height: 1080 }, CANVAS)

const markupFor = (templateKey: string, params: unknown): string => {
  const content = { type: 'text', templateKey, params } as unknown as RenderableClipContent
  const [clip] = buildTimelinePlan(makeDocument({ clips: [makeClip(1, 'TEXT', 0, 1, 0, content)] }), CANVAS).clips
  if (clip === undefined) throw new Error('clip plan が空です')
  return renderToStaticMarkup(<ClipBody clip={clip} fps={30} video={VIDEO} />)
}

const styled = (style: Record<string, unknown>, templateKey = 'plain') =>
  markupFor(templateKey, { text: '歌詞のテロップ', style })

describe('見た目の上書きが絵に出る', () => {
  it('色', () => {
    expect(styled({ color: '#FFD100' })).toContain('color:#FFD100')
  })

  it('大きさは画面の高さに対する割合（自動より優先）', () => {
    expect(styled({ size: 0.05 })).toContain('font-size:54px')
  })

  it('書体のまとまり（明朝）', () => {
    const markup = styled({ font: 'mincho' })
    expect(markup).toContain('Hiragino Mincho ProN')
    expect(markup).toContain('serif')
    expect(markup).not.toContain('@font-face')
  })

  it('太さ', () => {
    expect(styled({ weight: 'heavy' })).toContain('font-weight:900')
    expect(styled({ weight: 'regular' })).toContain('font-weight:400')
  })

  it('縁取りは文字の外側に（塗りの下に）描く', () => {
    const markup = styled({ size: 0.1, stroke: { color: '#000000', width: 0.1 } })
    expect(markup).toContain('-webkit-text-stroke:11px #000000')
    expect(markup).toContain('paint-order:stroke fill')
  })

  it('背景の帯は色と濃さ', () => {
    expect(styled({ background: { color: '#112233', opacity: 0.5 } })).toContain('rgba(17, 34, 51, 0.5)')
  })

  it('下帯の背景を消せる（左の線も一緒に消える。線だけ残ると飾りが浮く）', () => {
    const markup = styled({ background: null }, 'lower_third')
    expect(markup).not.toContain('rgba(0, 0, 0, 0.55)')
    expect(markup).not.toContain('border-left')
    expect(markupFor('lower_third', { text: '歌詞のテロップ' })).toContain('border-left')
  })

  it('定位置（左上）と揃え（右）', () => {
    const markup = styled({ anchor: 'top-left', align: 'right' })
    expect(markup).toContain('align-items:flex-start')
    expect(markup).toContain('justify-content:flex-start')
    expect(markup).toContain('text-align:right')
  })

  it('ずらしは画面の幅・高さに対する割合', () => {
    expect(styled({ offset: { x: 0.1, y: -0.05 } })).toContain('translate(192px, -54px)')
  })

  it('影', () => {
    expect(styled({ shadow: 'none' })).not.toContain('text-shadow')
    expect(styled({ shadow: 'strong' })).toContain('text-shadow')
  })

  it('見た目が読めなくても文字は既定の見た目で出す（赤枠にしない）', () => {
    const markup = styled({ color: 'red' })
    expect(markup).toContain('歌詞のテロップ')
    expect(markup).not.toContain('[text]')
    expect(markup).toContain('color:#FFFFFF')
  })

  it('style の無いテロップは今までと同じ見た目（中央・影・帯なし）', () => {
    const markup = markupFor('plain', { text: '歌詞のテロップ' })
    expect(markup).toContain('align-items:center')
    expect(markup).toContain('text-shadow')
    expect(markup).not.toContain('rgba(0, 0, 0, 0.55)')
  })
})

describe('textFadeOpacity', () => {
  const at = (frame: number, fadeInSec = 0, fadeOutSec = 0, durationInFrames = 90) =>
    textFadeOpacity({ frame, durationInFrames, fps: 30, fadeInSec, fadeOutSec })

  it('フェードが無ければ常に 1', () => {
    expect([at(0), at(45), at(89)]).toEqual([1, 1, 1])
  })

  it('フェードインは頭から指定の秒で 0 → 1', () => {
    expect(at(0, 1)).toBe(0)
    expect(at(15, 1)).toBeCloseTo(0.5, 5)
    expect(at(30, 1)).toBe(1)
  })

  it('フェードアウトは終わりに向けて 1 → 0', () => {
    expect(at(60, 0, 1)).toBe(1)
    expect(at(75, 0, 1)).toBeCloseTo(0.5, 5)
    expect(at(90, 0, 1)).toBe(0)
  })

  it('尺より長いフェードは、それぞれ尺の半分に縮める', () => {
    // 尺 1 秒（30 コマ）に 2 秒ずつのフェード → 15 コマずつ。
    expect(at(15, 2, 2, 30)).toBeCloseTo(1, 5)
    expect(at(0, 2, 2, 30)).toBe(0)
  })
})
