import { TransitionType } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { buildTimelinePlan, TRANSITION_SUPPORT } from '../plan.js'
import {
  makeClip,
  makeDocument,
  makeTransition,
  makeVideo1Shot,
  mediaContent,
  shotId,
  unresolvedContent,
} from './fixtures.js'

const CANVAS = { width: 1920, height: 1080 }

const twoShots = () => [makeVideo1Shot(1, 0, 2), makeVideo1Shot(2, 2, 2)]

describe('TRANSITION_SUPPORT', () => {
  it('TransitionType の全値について実装状況を明示している（無言で無視しない）', () => {
    expect(Object.keys(TRANSITION_SUPPORT).sort()).toEqual([...TransitionType.options].sort())
  })

  it('Phase 1 未実装のものは cut への縮退として宣言されている', () => {
    expect(TRANSITION_SUPPORT.wipe).toBe('degraded_to_cut')
    expect(TRANSITION_SUPPORT.whip_pan).toBe('degraded_to_cut')
    expect(TRANSITION_SUPPORT.glitch).toBe('degraded_to_cut')
  })
})

describe('buildTimelinePlan — VIDEO1', () => {
  /** Take が無い Shot の絵コンテの画像（制作者 2026-10-02）。種類が無い文書（これまでの記録）は動画。 */
  it('映すものの種類を運ぶ（無ければ動画）', () => {
    const document = makeDocument({
      video1: [makeVideo1Shot(1, 0, 4), { ...makeVideo1Shot(2, 4, 4), mediaUrl: 'https://media.test/S2.png', kind: 'image' }],
    })

    const plan = buildTimelinePlan(document, document.resolution)

    expect(plan.shots.map((shot) => shot.kind)).toEqual(['video', 'image'])
  })

  it('Shot を startSec から配置し、inSec を素材のシーク位置にする', () => {
    const doc = makeDocument({ video1: [makeVideo1Shot(1, 1.5, 2, 0.5)], durationSec: 4 })
    const [shot] = buildTimelinePlan(doc, CANVAS).shots
    expect(shot?.range).toEqual({ from: 45, durationInFrames: 60 })
    expect(shot?.startFrom).toBe(15)
  })

  it('後ろの Shot ほど下に重なる（ディゾルブの尻が隠れないように）', () => {
    const plan = buildTimelinePlan(makeDocument({ video1: twoShots() }), CANVAS)
    expect(plan.shots[0]?.zIndex).toBeGreaterThan(plan.shots[1]?.zIndex ?? 0)
  })

  it('尺 0 のタイムラインでも durationInFrames は 1 以上', () => {
    expect(buildTimelinePlan(makeDocument({ durationSec: 0 }), CANVAS).durationInFrames).toBe(1)
  })
})

describe('buildTimelinePlan — transitions', () => {
  it('cut は Shot の区間を変えない', () => {
    const doc = makeDocument({
      video1: twoShots(),
      transitions: [makeTransition(1, shotId(1), shotId(2), 'cut', 0.5)],
    })
    const plan = buildTimelinePlan(doc, CANVAS)
    expect(plan.shots[0]?.fadeOutFrames).toBe(0)
    expect(plan.shots[0]?.range.durationInFrames).toBe(60)
    expect(plan.dips).toEqual([])
  })

  it('dissolve は前の Shot を次の Shot に重ねて不透明度を落とす', () => {
    const doc = makeDocument({
      video1: twoShots(),
      transitions: [makeTransition(1, shotId(1), shotId(2), 'dissolve', 0.5)],
    })
    const plan = buildTimelinePlan(doc, CANVAS)
    expect(plan.shots[0]?.fadeOutFrames).toBe(15)
    // 本体 60 フレーム + ディゾルブ 15 フレーム。次の Shot の頭に重なる。
    expect(plan.shots[0]?.range.durationInFrames).toBe(75)
    // 次の Shot の開始位置は動かさない
    expect(plan.shots[1]?.range.from).toBe(60)
  })

  it('dissolve の尺が 0 なら重ねない', () => {
    const doc = makeDocument({
      video1: twoShots(),
      transitions: [makeTransition(1, shotId(1), shotId(2), 'dissolve', 0)],
    })
    expect(buildTimelinePlan(doc, CANVAS).shots[0]?.fadeOutFrames).toBe(0)
  })

  it.each([
    ['dip_to_black', '#000000'],
    ['dip_to_white', '#ffffff'],
  ] as const)('%s は境界をまたいで単色を挟む', (type, color) => {
    const doc = makeDocument({
      video1: twoShots(),
      transitions: [makeTransition(1, shotId(1), shotId(2), type, 0.5)],
    })
    const [dip] = buildTimelinePlan(doc, CANVAS).dips
    expect(dip?.color).toBe(color)
    // 境界 2.0 秒の前後 0.25 秒ずつ
    expect(dip?.range).toEqual({ from: 53, durationInFrames: 15 })
  })

  it('dip は Shot より前面に出る', () => {
    const doc = makeDocument({
      video1: twoShots(),
      transitions: [makeTransition(1, shotId(1), shotId(2), 'dip_to_black', 0.5)],
    })
    const plan = buildTimelinePlan(doc, CANVAS)
    const topShot = Math.max(...plan.shots.map((s) => s.zIndex))
    expect(plan.dips[0]?.zIndex).toBeGreaterThan(topShot)
  })

  it.each(['wipe', 'whip_pan', 'glitch'] as const)(
    '%s は cut に縮退し、縮退したことを呼び出し側に見せる',
    (type) => {
      const doc = makeDocument({
        video1: twoShots(),
        transitions: [makeTransition(1, shotId(1), shotId(2), type, 0.5)],
      })
      const plan = buildTimelinePlan(doc, CANVAS)
      expect(plan.shots[0]?.fadeOutFrames).toBe(0)
      expect(plan.dips).toEqual([])
      expect(plan.degradedTransitions).toHaveLength(1)
      expect(plan.degradedTransitions[0]?.type).toBe(type)
    },
  )

  it('実装済みのトランジションは縮退リストに載らない', () => {
    const doc = makeDocument({
      video1: twoShots(),
      transitions: [makeTransition(1, shotId(1), shotId(2), 'dissolve', 0.5)],
    })
    expect(buildTimelinePlan(doc, CANVAS).degradedTransitions).toEqual([])
  })
})

describe('buildTimelinePlan — clips と audio', () => {
  it('track ごとに層を分け、VIDEO2 < VFX < TEXT の順に重ねる', () => {
    const doc = makeDocument({
      clips: [makeClip(1, 'TEXT', 0, 1), makeClip(2, 'VIDEO2', 0, 1), makeClip(3, 'VFX', 0, 1)],
    })
    const plan = buildTimelinePlan(doc, CANVAS)
    const z = (track: string): number =>
      plan.clips.find((clip) => clip.track === track)?.zIndex ?? 0
    expect(z('VIDEO2')).toBeLessThan(z('VFX'))
    expect(z('VFX')).toBeLessThan(z('TEXT'))
  })

  it('同じ track では layer が大きいほど上', () => {
    const doc = makeDocument({ clips: [makeClip(1, 'TEXT', 0, 1, 0), makeClip(2, 'TEXT', 0, 1, 3)] })
    const plan = buildTimelinePlan(doc, CANVAS)
    expect(plan.clips[1]?.zIndex).toBeGreaterThan(plan.clips[0]?.zIndex ?? 0)
  })

  it('clips は Shot と dip より前面に出る', () => {
    const doc = makeDocument({
      video1: twoShots(),
      transitions: [makeTransition(1, shotId(1), shotId(2), 'dip_to_black', 0.5)],
      clips: [makeClip(1, 'VIDEO2', 0, 1)],
    })
    const plan = buildTimelinePlan(doc, CANVAS)
    expect(plan.clips[0]?.zIndex).toBeGreaterThan(plan.dips[0]?.zIndex ?? 0)
  })

  it('解決できなかったクリップも計画から落とさない（無言で消さない）', () => {
    const doc = makeDocument({
      clips: [makeClip(1, 'VIDEO2', 1, 2, 0, unresolvedContent('MediaAsset が見つかりません'))],
    })
    const [clip] = buildTimelinePlan(doc, CANVAS).clips
    expect(clip?.range).toEqual({ from: 30, durationInFrames: 60 })
    expect(clip?.content).toEqual({
      type: 'unresolved',
      reason: 'MediaAsset が見つかりません',
    })
  })

  it('解決済みメディアの URL と kind をそのまま渡す', () => {
    const doc = makeDocument({
      clips: [makeClip(1, 'VIDEO2', 0, 1, 0, mediaContent('image', 'https://media.test/x'))],
    })
    const [clip] = buildTimelinePlan(doc, CANVAS).clips
    expect(clip?.content).toMatchObject({ type: 'media', kind: 'image', mediaUrl: 'https://media.test/x' })
  })

  it('audio の startSec と volume を保つ', () => {
    const doc = makeDocument({
      audio: [{ mediaUrl: 'https://media.test/mv.mp3', startSec: 1, durationSec: 3, volume: 0.8 }],
    })
    const [track] = buildTimelinePlan(doc, CANVAS).audio
    expect(track?.range).toEqual({ from: 30, durationInFrames: 90 })
    expect(track?.volume).toBe(0.8)
  })
})

describe('buildTimelinePlan — キャンバス', () => {
  it('プリセット解像度を優先し、映像はレターボックスで収める', () => {
    const doc = makeDocument({ resolution: { width: 1920, height: 1080 } })
    const plan = buildTimelinePlan(doc, { width: 1080, height: 1920 })
    expect(plan.canvas).toEqual({ width: 1080, height: 1920 })
    expect(plan.video).toEqual({ width: 1080, height: 608, left: 0, top: 656 })
  })

  it('入力の TimelineDocument を変更しない', () => {
    const doc = makeDocument({ video1: twoShots() })
    const before = JSON.stringify(doc)
    buildTimelinePlan(doc, CANVAS)
    expect(JSON.stringify(doc)).toBe(before)
  })
})
