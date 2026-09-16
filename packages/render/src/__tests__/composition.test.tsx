import { createElement, isValidElement } from 'react'
import { describe, expect, it } from 'vitest'
import { TIMELINE_COMPOSITION_ID } from '../composition-id.js'
import { RemotionRoot } from '../compositions/Root.js'
import { TimelineComposition, type TimelineCompositionProps } from '../compositions/Timeline.js'
import {
  makeClip,
  makeDocument,
  makeTransition,
  makeVideo1Shot,
  mediaContent,
  shotId,
  unresolvedContent,
} from './fixtures.js'

/**
 * Remotion の実レンダリングはブラウザのダウンロードが要り、CI で回すには遅すぎる。
 * ここでは **props を受けてコンポジションが組み立てられること**だけを確認する。
 * 実際のピクセルは `renderer.ts` の結合確認（手動）に任せる。
 */
describe('TimelineComposition', () => {
  const props: TimelineCompositionProps = {
    doc: makeDocument({
      video1: [makeVideo1Shot(1, 0, 2), makeVideo1Shot(2, 2, 2, 0.5)],
      transitions: [makeTransition(1, shotId(1), shotId(2), 'dissolve', 0.5)],
      clips: [
        makeClip(1, 'TEXT', 0, 1),
        makeClip(2, 'VIDEO2', 1, 1, 0, mediaContent('video')),
        makeClip(3, 'VFX', 2, 1, 0, mediaContent('image')),
        makeClip(4, 'SFX', 2, 1, 0, mediaContent('audio')),
        makeClip(5, 'VIDEO2', 3, 1, 0, unresolvedContent('MediaAsset が見つかりません')),
      ],
      audio: [{ mediaUrl: 'https://media.test/mv.mp3', startSec: 0, durationSec: 4, volume: 1 }],
    }),
    canvas: { width: 1080, height: 1920 },
  }

  it('TimelineDocument だけを props に取って要素を構築できる', () => {
    const element = createElement(TimelineComposition, props)
    expect(isValidElement(element)).toBe(true)
    expect(element.props.doc.video1).toHaveLength(2)
    expect(element.props.doc.clips).toHaveLength(5)
  })

  it('外から解決済みメディアの辞書を渡す必要がない', () => {
    expect(Object.keys(props).sort()).toEqual(['canvas', 'doc'])
  })

  it('canvas を省略しても構築できる', () => {
    const element = createElement(TimelineComposition, { ...props, canvas: null })
    expect(isValidElement(element)).toBe(true)
  })

  it('Root も構築できる', () => {
    expect(isValidElement(createElement(RemotionRoot))).toBe(true)
  })

  it('コンポジション ID は Timeline', () => {
    expect(TIMELINE_COMPOSITION_ID).toBe('Timeline')
  })
})
