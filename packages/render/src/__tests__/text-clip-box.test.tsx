import {
  DEFAULT_DIALOGUE_TEXT_STYLE,
  DEFAULT_NARRATION_TEXT_STYLE,
  resolveTextStyle,
  type TextStyle,
  type TextTemplateKey,
} from '@ixa/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TextClip, textClipBoxWidthRatio, textClipFontSize } from '../compositions/text-clip.js'
import { letterboxFit } from '../presets.js'

/**
 * テロップの箱の余白（外側 `marginX`/`marginY`、帯の内側 `paddingX`/`paddingY`）。
 * 省けば今までと同じ絵（控えの HTML は `telop-markup-golden` が守る）。
 */
const LANDSCAPE = letterboxFit({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })
const PORTRAIT = letterboxFit({ width: 1080, height: 1920 }, { width: 1080, height: 1920 })

const markupOf = (template: TextTemplateKey, params: Record<string, unknown>, video = LANDSCAPE): string =>
  renderToStaticMarkup(<TextClip template={template} params={{ text: 'ねえ', ...params }} video={video} />)

const DIALOGUE_MARK = {
  shotId: '01ARZ3NDEKTSV4RRFFQ69G5F77',
  lineIndex: 0,
  placed: { startSec: 0, durationSec: 1.5 },
}

describe('既定の余白は今までの数と同じ絵', () => {
  it.each(['plain', 'lower_third'] as const)('%s: 既定値を明示しても 1 字も変わらない', (template) => {
    const style = { anchor: 'bottom-left', background: { color: '#000000', opacity: 0.5 } } as const
    expect(markupOf(template, { style: { ...style, marginY: 0.08, paddingX: 0.75, paddingY: 0.5 } })).toBe(
      markupOf(template, { style }),
    )
  })
})

describe('外側の余白', () => {
  it('左右の余白を当てると、箱の幅は画面から両側の余白を引いたもの', () => {
    expect(markupOf('lower_third', { style: { marginX: 0.1 } })).toContain('width:80%')
    expect(markupOf('plain', { style: { marginX: 0.05 } })).toContain('max-width:90%')
    expect(textClipBoxWidthRatio('plain', null)).toBe(0.8)
    expect(textClipBoxWidthRatio('lower_third', null)).toBe(0.9)
    expect(textClipBoxWidthRatio('plain', 0.05)).toBe(0.9)
  })

  it('端に寄せたときの左右の余白も同じ値', () => {
    expect(markupOf('plain', { style: { anchor: 'middle-left', marginX: 0.1 } })).toContain('margin-left:192px')
  })

  it('上下の余白は画面の高さに対する割合', () => {
    expect(markupOf('plain', { style: { anchor: 'bottom-center', marginY: 0.2 } }, PORTRAIT)).toContain('margin-bottom:384px')
    expect(markupOf('plain', { style: { anchor: 'top-center', marginY: 0 } })).toContain('margin-top:0')
  })

  it('左右の余白を広げると、文字の大きさの計算も狭い箱に合わせる', () => {
    const text = 'あ'.repeat(60)
    expect(textClipFontSize('plain', text, LANDSCAPE, 0.3)).toBeLessThan(textClipFontSize('plain', text, LANDSCAPE))
    expect(textClipFontSize('plain', text, LANDSCAPE, null)).toBe(textClipFontSize('plain', text, LANDSCAPE))
  })
})

describe('帯の内側の余白', () => {
  it('文字の大きさに対する割合（上下・左右）', () => {
    const markup = markupOf('plain', { style: { size: 0.1, paddingX: 0.2, paddingY: 0.1, background: { color: '#000000', opacity: 1 } } })
    expect(markup).toContain('padding:10.8px 21.6px')
  })

  it('帯が無ければ内側の余白は効かない', () => {
    expect(markupOf('plain', { style: { paddingX: 0.2, background: null } })).not.toContain('padding')
  })
})

/**
 * 9:16 で「ねえ、ネズミくん。」が「ねえ、ネズミく／ん。」と折れた（2026-10-26）。
 * 全角 1 字を 1em と数え、帯の内側の幅に 1 行で入るかを計算で見る。
 */
describe('セリフの字幕は 9:16 で短いセリフを 1 行に収める', () => {
  const TEXT = 'ねえ、ネズミくん。'
  const contentWidth = (style: TextStyle): { readonly fontSize: number; readonly width: number } => {
    const resolved = resolveTextStyle('plain', style)
    const fontSize = textClipFontSize('plain', TEXT, PORTRAIT, resolved.marginX)
    const box = PORTRAIT.width * textClipBoxWidthRatio('plain', resolved.marginX)
    const padding = resolved.background === null ? 0 : 2 * resolved.paddingX * fontSize
    return { fontSize, width: box - padding }
  }

  it('ナレーションの既定の箱では入らない（折れた原因）', () => {
    const { fontSize, width } = contentWidth(DEFAULT_NARRATION_TEXT_STYLE)
    expect([...TEXT].length * fontSize).toBeGreaterThan(width)
  })

  it('セリフの既定の箱なら、同じ大きさのまま 1 行に入る', () => {
    const narration = contentWidth(DEFAULT_NARRATION_TEXT_STYLE)
    const { fontSize, width } = contentWidth(DEFAULT_DIALOGUE_TEXT_STYLE)
    expect(fontSize).toBe(narration.fontSize)
    expect([...TEXT].length * fontSize).toBeLessThanOrEqual(width)
  })

  it('折れるときも語の途中で折らない（セリフの字幕だけ keep-all）', () => {
    const dialogue = markupOf('plain', { text: TEXT, style: DEFAULT_DIALOGUE_TEXT_STYLE, dialogue: DIALOGUE_MARK }, PORTRAIT)
    expect(dialogue).toContain('word-break:keep-all')
    expect(dialogue).toContain('overflow-wrap:anywhere')
    expect(markupOf('plain', { text: TEXT, style: DEFAULT_NARRATION_TEXT_STYLE }, PORTRAIT)).not.toContain('keep-all')
  })
})
