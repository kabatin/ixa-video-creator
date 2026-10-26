import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { RenderableClipContent } from '@ixa/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ClipBody } from '../compositions/Timeline.js'
import { buildTimelinePlan } from '../plan.js'
import { letterboxFit } from '../presets.js'
import { makeClip, makeDocument } from './fixtures.js'

/**
 * 訳文（2 段字幕。ADR-0061）を足す前のテロップの絵（HTML）を、丸ごと控えておく。
 * **訳文の無いテロップは 1 字も変わらない**ことを確かめる（横長・縦長、型・見た目・ナレーション。強調はコマの時刻が要るので `text-style-render` で見る）。
 * 控えは訳文を足す前の版で書いた（`GOLDEN_WRITE=1` で書き直せるが、書き直すのは絵を変えると決めたときだけ）。
 */
const GOLDEN = new URL('./golden/telops-without-translation.markup.json', import.meta.url)

const CASES: Readonly<Record<string, { readonly templateKey: string; readonly params: unknown }>> = {
  plain: { templateKey: 'plain', params: { text: '歌詞のテロップ' } },
  lowerThird: { templateKey: 'lower_third', params: { text: 'iXA CUP' } },
  styled: {
    templateKey: 'lower_third',
    params: {
      text: '見た目を当てたテロップ',
      style: {
        font: 'mincho',
        size: 0.05,
        weight: 'heavy',
        color: '#FFD100',
        stroke: { color: '#000000', width: 0.1 },
        anchor: 'top-left',
        offset: { x: 0.1, y: -0.05 },
      },
    },
  },
  narration: {
    templateKey: 'plain',
    params: {
      text: 'ナレーションの行',
      narrationLineId: '01ARZ3NDEKTSV4RRFFQ69G5F77',
      style: { anchor: 'bottom-center', weight: 'bold', color: '#ffffff', background: { color: '#000000', opacity: 0.45 } },
    },
  },
  long: { templateKey: 'plain', params: { text: 'あ'.repeat(120) } },
}

const CANVASES = { landscape: { width: 1920, height: 1080 }, portrait: { width: 1080, height: 1920 } } as const

const markupOf = (canvas: { readonly width: number; readonly height: number }, content: (typeof CASES)[string]): string => {
  const body = { type: 'text', ...content } as unknown as RenderableClipContent
  const [clip] = buildTimelinePlan(makeDocument({ clips: [makeClip(1, 'TEXT', 0, 1, 0, body)] }), canvas).clips
  if (clip === undefined) throw new Error('clip plan が空です')
  return renderToStaticMarkup(<ClipBody clip={clip} fps={30} video={letterboxFit(canvas, canvas)} />)
}

const current = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(CANVASES).flatMap(([canvasName, canvas]) =>
      Object.entries(CASES).map(([caseName, content]) => [`${canvasName}.${caseName}`, markupOf(canvas, content)]),
    ),
  )

describe('訳文の無いテロップの絵は前と同じ（ADR-0061）', () => {
  it('控えと 1 字も違わない', () => {
    if (process.env.GOLDEN_WRITE === '1') writeFileSync(GOLDEN, `${JSON.stringify(current(), null, 2)}\n`)
    expect(existsSync(GOLDEN)).toBe(true)
    expect(current()).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')))
  })
})
