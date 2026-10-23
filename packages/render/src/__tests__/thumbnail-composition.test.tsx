import { MediaAssetId, ThumbnailSpec, type ThumbnailSpecInput } from '@ixa/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ThumbnailComposition } from '../compositions/Thumbnail.js'
import type { ThumbnailBackgroundSource } from '../compositions/thumbnail-props.js'
import { makeDocument } from './fixtures.js'

/** サムネイルのコンポジション（ADR-0051）。何を描くかを HTML で確かめる（ピクセルは smoke テスト）。 */

// Remotion の <Img> はコンポジションの中でしか呼べない（コマの文脈を読む）。HTML を見るだけなので素の img にする。
vi.mock('remotion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('remotion')>()
  return { ...actual, Img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} /> }
})

const IMAGE = { kind: 'image', mediaAssetId: MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW') } as const
const URL = 'https://media.test/key-art.png'

const markup = (patch: Partial<ThumbnailSpecInput>, source: ThumbnailBackgroundSource): string =>
  renderToStaticMarkup(
    <ThumbnailComposition spec={ThumbnailSpec.parse({ background: IMAGE, title: '新曲 MV', ...patch })} source={source} />,
  )

describe('ThumbnailComposition', () => {
  it('画像の背景を覆って描き、寄せの位置へずらす', () => {
    const html = markup({ focusX: 0.25, focusY: 0.75 }, { kind: 'image', url: URL })
    expect(html).toContain(URL)
    expect(html).toContain('object-fit:cover')
    expect(html).toContain('object-position:25% 75%')
  })

  it('題名・副題を描き、題名は太字で縁取る', () => {
    const html = markup({ subtitle: '2026 秋' }, { kind: 'image', url: URL })
    expect(html).toContain('新曲')
    expect(html).toContain('MV')
    expect(html).toContain('2026 秋')
    expect(html).toContain('font-weight:900')
    expect(html).toContain('-webkit-text-stroke')
  })

  it('行は決めたとおりに 1 行ずつ描き、ブラウザに折り返させない', () => {
    const html = markup({ title: 'NIGHT RUN（試作）' }, { kind: 'image', url: URL })
    expect(html).toContain('white-space:nowrap')
    expect(html).toContain('>NIGHT')
    expect(html).not.toContain('overflow-wrap:anywhere')
  })

  it('副題が無ければ副題を出さない', () => {
    expect(markup({}, { kind: 'image', url: URL }).match(/<p /g)?.length).toBe(1)
  })

  it('題名の色・差し色・拡大を写す', () => {
    const html = markup({ titleColor: '#ff0000', accentColor: '#00ff00', zoom: 1.5 }, { kind: 'image', url: URL })
    expect(html).toContain('color:#ff0000')
    expect(html).toContain('background-color:#00ff00')
    expect(html).toContain('scale(1.5)')
  })

  it('副題の色を写す', () => {
    const html = markup({ subtitle: '2026 秋', subtitleColor: '#123456' }, { kind: 'image', url: URL })
    expect(html).toContain('color:#123456')
  })

  it('差し色のバーを消せば、線も帯も描かない', () => {
    for (const layout of ['middle_left', 'middle_center', 'bottom_left', 'top_center'] as const) {
      expect(markup({ layout, accentColor: '#00ff00' }, { kind: 'image', url: URL })).toContain('background-color:#00ff00')
      expect(markup({ layout, accentColor: '#00ff00', accentBar: false }, { kind: 'image', url: URL })).not.toContain(
        'background-color:#00ff00',
      )
    }
  })

  it('右・真ん中の配置は文字と差し色の線を同じ側へ寄せる', () => {
    const right = markup({ layout: 'middle_right' }, { kind: 'image', url: URL })
    expect(right).toContain('text-align:right')
    expect(right).toContain('align-self:flex-end')
    expect(right).toContain('to left')
    const top = markup({ layout: 'top_center' }, { kind: 'image', url: URL })
    expect(top).toContain('text-align:center')
    expect(top).toContain('to bottom')
  })

  it('3 マスだった頃の spec（layout: left）も描ける', () => {
    expect(markup({ layout: 'left' }, { kind: 'image', url: URL })).toContain('text-align:left')
  })

  it('背景の種類と材料が食い違えば、黙って黒くせず赤く知らせる', () => {
    const html = markup({}, { kind: 'timeline_frame', doc: makeDocument({}) })
    expect(html).toContain('背景の材料が仕様と合っていません')
    expect(html).not.toContain(URL)
  })
})
