import { isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Audio, Img, OffthreadVideo } from 'remotion'
import { describe, expect, it } from 'vitest'
import { ClipBody, ClipMedia } from '../compositions/Timeline.js'
import { buildTimelinePlan, type ClipPlan } from '../plan.js'
import { letterboxFit } from '../presets.js'
import { makeClip, makeDocument, mediaContent, unresolvedContent } from './fixtures.js'

const CANVAS = { width: 1920, height: 1080 }
const VIDEO = letterboxFit({ width: 1920, height: 1080 }, CANVAS)

const planFor = (clip: ReturnType<typeof makeClip>): ClipPlan => {
  const [first] = buildTimelinePlan(makeDocument({ clips: [clip] }), CANVAS).clips
  if (first === undefined) throw new Error('clip plan が空です')
  return first
}

const markupFor = (clip: ReturnType<typeof makeClip>): string =>
  renderToStaticMarkup(<ClipBody clip={planFor(clip)} fps={30} video={VIDEO} />)

describe('ClipBody — 解決できなかったクリップ', () => {
  it('unresolved は消えずにプレースホルダとして描画される', () => {
    const markup = markupFor(
      makeClip(1, 'VIDEO2', 0, 1, 0, unresolvedContent('MediaAsset が見つかりません')),
    )
    expect(markup).not.toBe('')
    expect(markup).toContain('[unresolved]')
  })

  it('unresolved は reason を画面に出す（原因が絵から分かる）', () => {
    const markup = markupFor(makeClip(1, 'VIDEO2', 0, 1, 0, unresolvedContent('署名付き URL の発行に失敗')))
    expect(markup).toContain('署名付き URL の発行に失敗')
  })

  it('unresolved は目立つ色で描く（黒画面と区別できる）', () => {
    const markup = markupFor(makeClip(1, 'VIDEO2', 0, 1, 0, unresolvedContent('欠落')))
    expect(markup).toContain('#ff5555')
  })

  it('clip の opacity と zIndex はプレースホルダにも効く', () => {
    const clip = { ...makeClip(1, 'TEXT', 0, 1, 0, unresolvedContent('欠落')), opacity: 0.5 }
    const markup = renderToStaticMarkup(<ClipBody clip={planFor(clip)} fps={30} video={VIDEO} />)
    expect(markup).toContain('opacity:0.5')
  })
})

describe('ClipBody — Phase 1 のプレースホルダ', () => {
  it('text は templateKey を出す', () => {
    expect(markupFor(makeClip(1, 'TEXT', 0, 1))).toContain('[text] lower_third')
  })

  it('motion_graphics も templateKey を出す', () => {
    const clip = makeClip(1, 'VFX', 0, 1, 0, {
      type: 'motion_graphics',
      templateKey: 'ink_splash',
      params: {},
    })
    expect(markupFor(clip)).toContain('[motion_graphics] ink_splash')
  })
})

describe('ClipMedia — kind で分岐する（拡張子では判断しない）', () => {
  // ClipMedia 自身はフックを持たないため、素の関数として呼べる。
  // React にレンダリングさせると Img / OffthreadVideo が Remotion のコンテキストを要求するので、
  // ここでは「どのコンポーネントを選んだか」だけを見る。
  const chosen = (kind: 'image' | 'video' | 'audio'): unknown => {
    const content = mediaContent(kind, 'https://media.test/signed-url-without-extension')
    if (content.type !== 'media') throw new Error('media ではありません')
    const element = ClipMedia({ content, fps: 30, video: VIDEO })
    if (!isValidElement(element)) throw new Error('React 要素が返りませんでした')
    return element.type
  }

  it('image は Img を選ぶ', () => {
    expect(chosen('image')).toBe(Img)
  })

  it('video は OffthreadVideo を選ぶ', () => {
    expect(chosen('video')).toBe(OffthreadVideo)
  })

  it('audio は Audio を選ぶ', () => {
    expect(chosen('audio')).toBe(Audio)
  })
})
