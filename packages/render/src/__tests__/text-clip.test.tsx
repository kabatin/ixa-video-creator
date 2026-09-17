import {
  MAX_TEXT_CLIP_LENGTH,
  TEXT_TEMPLATE_SUPPORT,
  type RenderableClipContent,
  type TextTemplateKey,
} from '@ixa/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ClipBody } from '../compositions/Timeline.js'
import {
  textClipBlockHeight,
  textClipFontSize,
  textClipLayout,
} from '../compositions/text-clip.js'
import { buildTimelinePlan, type ClipPlan } from '../plan.js'
import { letterboxFit } from '../presets.js'
import { makeClip, makeDocument } from './fixtures.js'

const CANVAS = { width: 1920, height: 1080 }
const VIDEO = letterboxFit({ width: 1920, height: 1080 }, CANVAS)

/** レターボックスが出る組み合わせ。文字が黒帯にはみ出さないことの確認に使う。 */
const VERTICAL_CANVAS = { width: 1080, height: 1920 }
const LETTERBOXED = letterboxFit({ width: 1920, height: 1080 }, VERTICAL_CANVAS)

/**
 * テロップの中身。**型が禁じている値もわざと入れる。**
 * `params` は DB の JSON 由来で、型検査は実データを守ってくれないため、
 * 壊れた値が来たときにレンダラがどうなるかを確かめる必要がある。
 */
const textContent = (templateKey: string, params: unknown): RenderableClipContent =>
  ({ type: 'text', templateKey, params }) as unknown as RenderableClipContent

const planFor = (content: RenderableClipContent): ClipPlan => {
  const clip = makeClip(1, 'TEXT', 0, 1, 0, content)
  const [first] = buildTimelinePlan(makeDocument({ clips: [clip] }), CANVAS).clips
  if (first === undefined) throw new Error('clip plan が空です')
  return first
}

const markupFor = (templateKey: string, params: unknown): string =>
  renderToStaticMarkup(<ClipBody clip={planFor(textContent(templateKey, params))} fps={30} video={VIDEO} />)

/** 実際に映像制作で入れる日本語。ASCII だけで確認すると日本語が出ない不具合を見逃す。 */
const JP_TEXT = 'iXA CUP 決勝トーナメント 開幕'

describe('テロップが絵に出る', () => {
  it('plain は日本語の文字をそのまま出力に出す', () => {
    const markup = markupFor('plain', { text: JP_TEXT })
    expect(markup).toContain(JP_TEXT)
  })

  it('lower_third も日本語の文字をそのまま出力に出す', () => {
    const markup = markupFor('lower_third', { text: JP_TEXT })
    expect(markup).toContain(JP_TEXT)
  })

  it('描けたときはプレースホルダを出さない', () => {
    expect(markupFor('plain', { text: JP_TEXT })).not.toContain('[text]')
  })

  it('日本語が出るフォント指定になっている（外部フォントを読み込まない）', () => {
    const markup = markupFor('plain', { text: JP_TEXT })
    expect(markup).toContain('sans-serif')
    expect(markup).not.toContain('@font-face')
    expect(markup).not.toContain('fonts.googleapis.com')
  })

  it('clip の opacity はテロップにも効く', () => {
    const clip = { ...makeClip(1, 'TEXT', 0, 1, 0, textContent('plain', { text: JP_TEXT })), opacity: 0.4 }
    const [first] = buildTimelinePlan(makeDocument({ clips: [clip] }), CANVAS).clips
    if (first === undefined) throw new Error('clip plan が空です')
    expect(renderToStaticMarkup(<ClipBody clip={first} fps={30} video={VIDEO} />)).toContain('opacity:0.4')
  })
})

describe('2 種類のテンプレートは見た目が違う', () => {
  const plain = markupFor('plain', { text: JP_TEXT })
  const lowerThird = markupFor('lower_third', { text: JP_TEXT })

  it('同じ文字でも出力が一致しない', () => {
    expect(plain).not.toBe(lowerThird)
  })

  it('plain は中央に置き、帯を敷かない', () => {
    expect(plain).toContain('data-text-template="plain"')
    expect(plain).toContain('align-items:center')
    expect(plain).not.toContain('rgba(0, 0, 0, 0.55)')
  })

  it('lower_third は下寄せの帯に載せる', () => {
    expect(lowerThird).toContain('data-text-template="lower_third"')
    expect(lowerThird).toContain('align-items:flex-end')
    expect(lowerThird).toContain('rgba(0, 0, 0, 0.55)')
  })

  it('lower_third のほうが文字が小さい（帯に載る前提の大きさ）', () => {
    expect(textClipFontSize('lower_third', JP_TEXT, VIDEO)).toBeLessThan(
      textClipFontSize('plain', JP_TEXT, VIDEO),
    )
  })
})

describe('params が読めないときはプレースホルダのままにする', () => {
  it('params が空のときは壊れていることを絵に出す', () => {
    const markup = markupFor('plain', {})
    expect(markup).toContain('[text] plain')
    expect(markup).toContain('#ff5555')
  })

  it('params の型が違うときも消えない', () => {
    expect(markupFor('plain', { text: 42 })).toContain('[text] plain')
  })

  it('params がオブジェクトですらないときも消えない', () => {
    expect(markupFor('plain', null)).toContain('[text] plain')
  })

  it('文字が空のときは「文字が無いテロップ」を描かず、壊れていると分かる形にする', () => {
    const markup = markupFor('lower_third', { text: '   ' })
    expect(markup).not.toBe('')
    expect(markup).toContain('[text] lower_third')
    expect(markup).toContain('#ff5555')
  })

  it('知らないテンプレートは枠だけ出す（壊れている赤とは区別する）', () => {
    const markup = markupFor('kinetic_typography', { text: JP_TEXT })
    expect(markup).toContain('[text] kinetic_typography')
    expect(markup).not.toContain('#ff5555')
    expect(markup).not.toContain(JP_TEXT)
  })
})

/**
 * **移行していない実データがそのまま通る経路。**
 * 本番の DB に残っている形をそのまま置く。
 * 登録簿は `lower_third`（下線）に変わり、文字は `params.text` になったので、
 * このクリップは**テンプレート名も中身も**新しい契約に当てはまらない。
 */
describe('古いテロップ（templateKey: lower-third / params: { label }）', () => {
  const LEGACY_TEMPLATE_KEY = 'lower-third'
  const LEGACY_PARAMS = { label: 'iXA CUP' }

  it('無言で消えない', () => {
    const markup = markupFor(LEGACY_TEMPLATE_KEY, LEGACY_PARAMS)
    expect(markup).not.toBe('')
    expect(markup).toContain(`[text] ${LEGACY_TEMPLATE_KEY}`)
  })

  it('テロップとしては描かない（label を文字として拾わない）', () => {
    const markup = markupFor(LEGACY_TEMPLATE_KEY, LEGACY_PARAMS)
    expect(markup).not.toContain('data-text-template')
    expect(markup).not.toContain(LEGACY_PARAMS.label)
  })

  it('直し方が絵から分かる（使えるテンプレート名を出す）', () => {
    const markup = markupFor(LEGACY_TEMPLATE_KEY, LEGACY_PARAMS)
    expect(markup).toContain('lower_third')
    expect(markup).toContain('plain')
  })

  it('「テンプレートが分からない」と「文字を読めない」を同じ文言に畳まない', () => {
    // 前者はテンプレート名を直せば済み、後者は文字を入れ直す必要がある。
    // 同じ見た目にすると、絵を見た人がどちらを直せばよいか判断できない（lessons L-015）。
    const unknownTemplate = markupFor(LEGACY_TEMPLATE_KEY, LEGACY_PARAMS)
    const unreadableParams = markupFor('lower_third', LEGACY_PARAMS)

    expect(unknownTemplate).not.toContain('#ff5555')
    expect(unreadableParams).toContain('#ff5555')
    expect(unknownTemplate).toContain('テンプレート')
    expect(unreadableParams).toContain('中身')
  })
})

describe('長い文字が画面からはみ出さない', () => {
  const longest = 'あ'.repeat(MAX_TEXT_CLIP_LENGTH)

  it('上限ちょうどの長さでも描ける', () => {
    expect(markupFor('plain', { text: longest })).toContain(longest)
  })

  it('上限を超える長さは domain が弾き、プレースホルダになる', () => {
    const tooLong = 'あ'.repeat(MAX_TEXT_CLIP_LENGTH + 1)
    const markup = markupFor('plain', { text: tooLong })
    expect(markup).toContain('[text] plain')
    expect(markup).not.toContain(tooLong)
  })

  it('長い文字ほど小さくなる', () => {
    expect(textClipFontSize('plain', longest, VIDEO)).toBeLessThan(
      textClipFontSize('plain', '開幕', VIDEO),
    )
  })

  it.each(Object.keys(TEXT_TEMPLATE_SUPPORT) as TextTemplateKey[])(
    '%s は上限の長さでも映像の枠に収まる（レターボックスの黒帯にも出ない）',
    (template) => {
      for (const video of [VIDEO, LETTERBOXED]) {
        const layout = textClipLayout(template)
        const fontSize = textClipFontSize(template, longest, video)
        // 全角 1 文字 = 1em として、実際の箱の幅から必要な行数を数える。
        const charsPerLine = Math.floor((video.width * layout.widthRatio) / fontSize)
        const lines = Math.ceil(longest.length / charsPerLine)

        expect(lines).toBeLessThanOrEqual(layout.maxLines)
        // 余白（帯の内側・下からの離し）に使う分を残して高さを収める。
        expect(textClipBlockHeight(template, fontSize)).toBeLessThanOrEqual(video.height * 0.6)
      }
    },
  )

  it('短い文字は大きくしすぎない（映像の高さの上限で頭打ちにする）', () => {
    expect(textClipFontSize('plain', 'あ', VIDEO)).toBeLessThanOrEqual(VIDEO.height * 0.12)
  })
})

/**
 * **`wipe` の再発を止める仕掛け。**
 * domain の表にキーを足して描き方を足し忘れたら、ここが落ちる。
 */
describe('TEXT_TEMPLATE_SUPPORT に載っているキーは全部この分岐を通る', () => {
  const entries = Object.entries(TEXT_TEMPLATE_SUPPORT) as [
    TextTemplateKey,
    'implemented' | 'placeholder',
  ][]

  it('表が空ではない（テストが素通りしない）', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it.each(entries)('%s（%s）は表のとおりに描かれる', (template, support) => {
    const markup = markupFor(template, { text: JP_TEXT })

    if (support === 'implemented') {
      expect(markup).toContain(JP_TEXT)
      expect(markup).not.toContain('[text]')
      expect(markup).toContain(`data-text-template="${template}"`)
      return
    }

    expect(markup).toContain(`[text] ${template}`)
    expect(markup).not.toContain(JP_TEXT)
  })
})

describe('motion_graphics は今回の範囲外（プレースホルダのまま）', () => {
  it('templateKey を出すだけで、テロップとして描かない', () => {
    const clip = makeClip(1, 'VFX', 0, 1, 0, {
      type: 'motion_graphics',
      templateKey: 'ink_splash',
      params: { text: JP_TEXT },
    })
    const [first] = buildTimelinePlan(makeDocument({ clips: [clip] }), CANVAS).clips
    if (first === undefined) throw new Error('clip plan が空です')
    const markup = renderToStaticMarkup(<ClipBody clip={first} fps={30} video={VIDEO} />)
    expect(markup).toContain('[motion_graphics] ink_splash')
    expect(markup).not.toContain('data-text-template')
  })
})
