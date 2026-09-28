import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { Sequence } from 'remotion'
import { describe, expect, it } from 'vitest'
import { TIMELINE_COMPOSITION_ID } from '../composition-id.js'
import { RemotionRoot } from '../compositions/Root.js'
import {
  TimelineComposition,
  timelineLayers,
  type TimelineCompositionProps,
} from '../compositions/Timeline.js'
import { buildTimelinePlan } from '../plan.js'
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
 * Player は Shot の `<Sequence>` が始まった瞬間に素材の読み込みを始めるので、境目ごとに
 * 0.1〜0.2 秒黒が挟まった。始まる前から組み立てておく（`premountFor`）。
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

  // 並べ方はフックを持たない関数に切り出してある。null はコマに依らずすべて。
  const layersOf = (target: typeof doc) => sequencesOf(timelineLayers(buildTimelinePlan(target, target.resolution), null))
  const sequences = layersOf(doc)
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

  /**
   * 既定の `opacity: 0` で待たせると、ブラウザはコマを画面に出さず、見え始めの 1 コマが黒になった。
   * コマが出なければ下敷きにも写せない。後の Shot ほど重なり順が低いので、見えていても前の Shot の裏に隠れる。
   */
  it('前の Shot と続く Shot は、待っている間も見える状態で裏に置く', () => {
    const shots = sequences.filter((sequence) => 'shot' in bodyOf(sequence))
    expect(shots[0]?.props.styleWhilePremounted).toBeUndefined()
    expect(shots[1]?.props.styleWhilePremounted).toEqual({ opacity: 1 })
  })

  it('隙間の後の Shot は隠したまま待つ（黒のはずの間に頭を見せない）', () => {
    const gapped = layersOf(
      makeDocument({ video1: [makeVideo1Shot(1, 0, 2), makeVideo1Shot(2, 3, 2)] }),
    ).filter((sequence) => 'shot' in bodyOf(sequence))
    expect(gapped[1]?.props.styleWhilePremounted).toBeUndefined()
  })

  /**
   * 次の Shot の動画が読み込みに間に合わないと、Safari では動画も下敷きも空で黒が出た。
   * 前の Shot を一番下に 1 秒残し、下敷きに残る最後のコマを見せる。
   */
  it('次の Shot が続く Shot だけ、切り替わった後も一番下に残す', () => {
    const shots = sequences.filter((sequence) => 'shot' in bodyOf(sequence))
    expect(shots[0]?.props).toMatchObject({
      postmountFor: doc.fps,
      styleWhilePostmounted: { opacity: 1, zIndex: -1 },
    })
    // 最後の Shot は残さない（終わった後の黒のはずの間に絵を残さない）。
    expect(shots[1]?.props.postmountFor).toBeUndefined()
  })

  it('隙間の前の Shot は残さない', () => {
    const gapped = layersOf(
      makeDocument({ video1: [makeVideo1Shot(1, 0, 2), makeVideo1Shot(2, 3, 2)] }),
    ).filter((sequence) => 'shot' in bodyOf(sequence))
    expect(gapped[0]?.props.postmountFor).toBeUndefined()
  })

  it('メディアのクリップも同じく前もって組み立てる', () => {
    const clips = sequences.filter((sequence) => 'clip' in bodyOf(sequence))
    expect(clips).toHaveLength(2)
    for (const clip of clips) expect(clip.props.premountFor).toBe(doc.fps)
  })
})

/**
 * **いまのコマの近くだけ組み立てる。**
 *
 * Remotion の `<Sequence>` は範囲の外でも毎コマ描き直される。モトダチ MV（Shot 27・テロップ 28）では
 * 1 コマごとに部品 300 余りを描き直し、主スレッドが詰まって、プレビューの音が 0.7〜0.9 秒
 * 巻き戻って鳴り直した（2026-09-28 実測）。範囲外の Sequence は何も描かないので、外しても絵は同じ。
 */
describe('いまのコマの近くだけ組み立てる', () => {
  const fps = 30
  const doc = makeDocument({
    video1: [makeVideo1Shot(1, 0, 2), makeVideo1Shot(2, 2, 2), makeVideo1Shot(3, 4, 2)],
    clips: [makeClip(1, 'TEXT', 5, 1)],
    audio: [{ mediaUrl: 'https://media.test/mv.mp3', startSec: 0, durationSec: 6, volume: 1 }],
  })
  const plan = buildTimelinePlan(doc, doc.resolution)
  /** 木の中の Shot・クリップ・音の部品を、並んだ順に名前で拾う。 */
  const kindsIn = (node: ReactNode): string[] =>
    Children.toArray(node).flatMap((child) => {
      if (!isValidElement<Record<string, unknown>>(child)) return []
      const props = child.props
      if ('shot' in props) return [(props.shot as { shotId: string }).shotId]
      if ('clip' in props) return ['clip']
      if ('track' in props) return ['audio']
      return kindsIn(props.children as ReactNode)
    })
  const kindsAt = (frame: number): string[] => kindsIn(timelineLayers(plan, frame))

  it('範囲の外の Shot とクリップは組み立てない', () => {
    expect(kindsAt(0)).toEqual([shotId(1), 'audio'])
  })

  it('始まる 1 秒前からは組み立てる（premount の間）', () => {
    expect(kindsAt(2 * fps - fps)).toEqual([shotId(1), shotId(2), 'audio'])
  })

  it('続く Shot がある間は、終わった後も 1 秒残す（postmount の間）', () => {
    expect(kindsAt(2 * fps + fps - 1)).toContain(shotId(1))
    expect(kindsAt(2 * fps + fps + 2)).not.toContain(shotId(1))
  })

  it('クリップも始まる 1 秒前から、終わったら外す', () => {
    expect(kindsAt(5 * fps - fps)).toContain('clip')
    expect(kindsAt(5 * fps - fps - 2)).not.toContain('clip')
    expect(kindsAt(6 * fps + 1)).not.toContain('clip')
  })

  it('音は区間に依らず組み立てたまま（付け外しで頭出しし直さない）', () => {
    expect(kindsAt(6 * fps + 10)).toContain('audio')
  })
})
