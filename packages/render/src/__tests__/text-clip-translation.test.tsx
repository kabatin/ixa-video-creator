import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TextClip, textClipFontSize, textClipTranslationFontSize } from '../compositions/text-clip.js'
import { letterboxFit } from '../presets.js'

/**
 * 2 段字幕（ADR-0061）。訳文があれば、本文の下に小さめの 2 段目を描く。
 * 大きさは本文の大きさ（短い辺が基準）に `translationScale` を掛けたもの。長い訳文は流し込み幅に収まるまで縮める。
 */
const LANDSCAPE = letterboxFit({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })
const PORTRAIT = letterboxFit({ width: 1080, height: 1920 }, { width: 1080, height: 1920 })

const fontSizes = (markup: string): readonly number[] =>
  [...markup.matchAll(/font-size:(\d+)px/g)].map((match) => Number(match[1]))

describe('2 段目を描く', () => {
  it('訳文があれば、本文の下に別の段で描く', () => {
    const markup = renderToStaticMarkup(
      <TextClip template="lower_third" params={{ text: 'ねえ、ネズミくん。', translation: 'Hey, little mouse.' }} video={LANDSCAPE} />,
    )
    expect(markup).toContain('data-telop-translation')
    expect(markup.indexOf('ねえ、ネズミくん。')).toBeLessThan(markup.indexOf('Hey, little mouse.'))
  })

  it('2 段目は本文の 0.6 倍（既定）', () => {
    const markup = renderToStaticMarkup(
      <TextClip template="lower_third" params={{ text: 'ねえ', translation: 'Hey' }} video={LANDSCAPE} />,
    )
    const [main, translation] = fontSizes(markup)
    expect(main).toBe(textClipFontSize('lower_third', 'ねえ', LANDSCAPE))
    expect(translation).toBe(Math.round((main ?? 0) * 0.6))
  })

  it('translationScale で大きさを変えられる', () => {
    const markup = renderToStaticMarkup(
      <TextClip
        template="plain"
        params={{ text: 'ねえ', translation: 'Hey', style: { size: 0.05, translationScale: 0.8 } }}
        video={LANDSCAPE}
      />,
    )
    expect(fontSizes(markup)).toEqual([54, 43])
  })

  it('縦長（9:16）でも短い辺（幅）が基準。横長と同じ大きさになる', () => {
    const style = { size: 0.05 }
    const landscape = renderToStaticMarkup(<TextClip template="plain" params={{ text: 'ねえ', translation: 'Hey', style }} video={LANDSCAPE} />)
    const portrait = renderToStaticMarkup(<TextClip template="plain" params={{ text: 'ねえ', translation: 'Hey', style }} video={PORTRAIT} />)
    expect(fontSizes(portrait)).toEqual(fontSizes(landscape))
  })

  it('訳文が無ければ 2 段目の箱を作らない', () => {
    const markup = renderToStaticMarkup(<TextClip template="plain" params={{ text: 'ねえ' }} video={LANDSCAPE} />)
    expect(markup).not.toContain('data-telop-translation')
  })
})

describe('textClipTranslationFontSize', () => {
  it('短い訳文は本文 × 割合', () => {
    expect(textClipTranslationFontSize({ template: 'lower_third', mainFontSize: 60, scale: 0.6, translation: 'Hey', video: LANDSCAPE })).toBe(36)
  })

  it('長い訳文は流し込み幅に収まるまで縮める（本文 × 割合を超えない）', () => {
    const long = 'a'.repeat(400)
    const size = textClipTranslationFontSize({ template: 'lower_third', mainFontSize: 60, scale: 0.6, translation: long, video: LANDSCAPE })
    expect(size).toBeLessThan(36)
    expect(size).toBeGreaterThanOrEqual(1)
  })
})
