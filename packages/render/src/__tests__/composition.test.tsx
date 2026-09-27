import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { Sequence } from 'remotion'
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

/**
 * **プレビューでカットの頭が黒くならないこと**（2026-09-27、モトダチ MV の通し再生で実測）。
 *
 * Player（ブラウザの `<video>`）は Shot の `<Sequence>` が始まった瞬間に読み込みと頭出しを始めるので、
 * 境目ごとに 0.1〜0.2 秒黒が挟まった。始まる前から見えない状態で組み立てておく（`premountFor`）。
 * 書き出し（renderMedia）では Remotion が premount を使わないので、絵は変わらない。
 */
describe('Shot とクリップを前もって組み立てておく', () => {
  const doc = makeDocument({
    video1: [makeVideo1Shot(1, 0, 2), makeVideo1Shot(2, 2, 2)],
    transitions: [makeTransition(1, shotId(1), shotId(2), 'dip_to_black', 0.5)],
    clips: [makeClip(1, 'VIDEO2', 1, 1, 0, mediaContent('video')), makeClip(2, 'TEXT', 0, 1)],
  })

  const sequencesOf = (node: ReactNode): ReactElement<Record<string, unknown>>[] =>
    Children.toArray(node).flatMap((child) => {
      if (!isValidElement<Record<string, unknown>>(child)) return []
      const own = child.type === Sequence ? [child] : []
      return [...own, ...sequencesOf(child.props.children as ReactNode)]
    })

  // フックを持たない関数なので、素の関数として呼んで要素の木を見る。
  const sequences = sequencesOf(TimelineComposition({ doc, canvas: null }) as ReactElement)
  const bodyOf = (sequence: ReactElement<Record<string, unknown>>) =>
    (Children.only(sequence.props.children as ReactElement<Record<string, unknown>>).props)

  it('Shot の Sequence は 1 秒前から組み立てる（layout="none" では premount できない）', () => {
    const shots = sequences.filter((sequence) => 'shot' in bodyOf(sequence))
    expect(shots).toHaveLength(2)
    for (const shot of shots) {
      expect(shot.props.premountFor).toBe(doc.fps)
      expect(shot.props.layout).not.toBe('none')
    }
  })

  it('メディアのクリップも同じく前もって組み立てる', () => {
    const clips = sequences.filter((sequence) => 'clip' in bodyOf(sequence))
    expect(clips).toHaveLength(2)
    for (const clip of clips) expect(clip.props.premountFor).toBe(doc.fps)
  })
})
