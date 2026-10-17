import type { ThumbnailLayout } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  MIN_TITLE_SIZE,
  TEXT_BLOCKS,
  TITLE_LINE_HEIGHT,
  fitThumbnailText,
} from '../compositions/thumbnail-layout.js'
import { textWidthEm, tokenizeTitle, wrapAtoms } from '../compositions/thumbnail-text-fit.js'

/**
 * サムネイルの題名の折り返しと大きさ（ADR-0051）。2026-10-17 の実機で「左に文字」の
 * 「NIGHT RUN（試作）」が「NIGH / T / RUN / （試 / 作）」と切れ、字も列に対して大きすぎた。
 */

const LAYOUTS: readonly ThumbnailLayout[] = ['left', 'center', 'bottom']

const TITLES = {
  shortJp: '新曲',
  shortEn: 'MV',
  mixed: 'NIGHT RUN（試作）',
  longJp: 'あ'.repeat(40),
  longEn: 'THE QUICK BROWN FOX JUMPS OVER LAZY DOG',
  longWord: 'SUPERCALIFRAGILISTIC',
} as const

const allWords = (text: string): readonly string[] => text.split(/[\s（）]+/).filter((word) => /^[A-Za-z]+$/.test(word))

describe('tokenizeTitle（切ってよい所）', () => {
  it('英単語は 1 つの塊、和文は 1 字ずつ。開き括弧は次の字に、閉じ括弧は前の字に付く', () => {
    expect(tokenizeTitle('NIGHT RUN（試作）').map((atom) => atom.text)).toEqual(['NIGHT', 'RUN', '（試', '作）'])
    expect(tokenizeTitle('NIGHT RUN').map((atom) => atom.spaceBefore)).toEqual([false, true])
  })

  it('句読点・長音は行頭に来ない（前の字に付く）', () => {
    expect(tokenizeTitle('ラー、メン。').map((atom) => atom.text)).toEqual(['ラー、', 'メ', 'ン。'])
  })

  it('数字と英字が続けば 1 つの塊（2026MV を切らない）', () => {
    expect(tokenizeTitle('新曲2026MV').map((atom) => atom.text)).toEqual(['新', '曲', '2026MV'])
  })
})

describe('wrapAtoms', () => {
  it('入るだけ詰めて、空白か和文の間でだけ改行する', () => {
    expect(wrapAtoms(tokenizeTitle('NIGHT RUN（試作）'), 4)).toEqual(['NIGHT', 'RUN', '（試作）'])
  })
})

describe('fitThumbnailText（3 つの配置 × 短い・長い × 和文・英文）', () => {
  for (const layout of LAYOUTS) {
    for (const [name, title] of Object.entries(TITLES)) {
      it(`${layout} / ${name}: 行数・幅・高さが列に収まる`, () => {
        const block = TEXT_BLOCKS[layout]
        const { title: fitted } = fitThumbnailText({ title, subtitle: null, layout })
        expect(fitted.lines.length).toBeLessThanOrEqual(block.maxTitleLines)
        for (const line of fitted.lines) expect(textWidthEm(line) * fitted.size).toBeLessThanOrEqual(block.width)
        expect(fitted.lines.length * fitted.size * TITLE_LINE_HEIGHT).toBeLessThanOrEqual(block.height)
        expect(fitted.size).toBeGreaterThanOrEqual(MIN_TITLE_SIZE)
        // 字を足しも減らしもしない（空白は改行に置き換わるだけ）。
        expect(fitted.lines.join('').replace(/\s/g, '')).toBe(title.replace(/\s/g, ''))
      })

      if (name !== 'longWord') {
        it(`${layout} / ${name}: 英単語を途中で切らない`, () => {
          const { title: fitted } = fitThumbnailText({ title, subtitle: null, layout })
          const words = new Set(fitted.lines.flatMap((line) => allWords(line)))
          for (const word of allWords(title)) expect(words.has(word)).toBe(true)
        })
      }
    }
  }

  it('左の「NIGHT RUN（試作）」は NIGHT を切らず、左の列に収まる大きさまで縮める', () => {
    const { title } = fitThumbnailText({ title: 'NIGHT RUN（試作）', subtitle: null, layout: 'left' })
    expect(title.lines.some((line) => line.includes('NIGHT'))).toBe(true)
    expect(title.size).toBeLessThan(TEXT_BLOCKS.left.maxTitleSize)
  })

  it('短い題名は配置の上限まで大きい', () => {
    for (const layout of LAYOUTS) {
      expect(fitThumbnailText({ title: '新曲', subtitle: null, layout }).title.size).toBe(TEXT_BLOCKS[layout].maxTitleSize)
    }
  })

  it('長い題名ほど小さい', () => {
    const short = fitThumbnailText({ title: '新曲', subtitle: null, layout: 'center' }).title.size
    const long = fitThumbnailText({ title: TITLES.longJp, subtitle: null, layout: 'center' }).title.size
    expect(long).toBeLessThan(short)
  })

  it('副題があれば題名はその分だけ低く収め、副題も列に収める', () => {
    for (const layout of LAYOUTS) {
      const block = TEXT_BLOCKS[layout]
      const fitted = fitThumbnailText({ title: TITLES.longEn, subtitle: 'い'.repeat(60), layout })
      expect(fitted.subtitle).not.toBeNull()
      const subtitle = fitted.subtitle ?? { size: 0, lines: [] }
      expect(subtitle.lines.length).toBeLessThanOrEqual(block.maxSubtitleLines)
      for (const line of subtitle.lines) expect(textWidthEm(line) * subtitle.size).toBeLessThanOrEqual(block.width)
      expect(subtitle.size).toBeLessThanOrEqual(fitted.title.size)
    }
  })

  it('同じ入力なら同じ行（画面と書き出しが同じ切れ目になる）', () => {
    const spec = { title: TITLES.mixed, subtitle: '2026 秋', layout: 'left' } as const
    expect(fitThumbnailText(spec)).toEqual(fitThumbnailText(spec))
  })
})
