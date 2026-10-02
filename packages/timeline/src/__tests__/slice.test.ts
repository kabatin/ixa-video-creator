import type { TimelineDocument } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { sliceTimelineDocument } from '../slice.js'
import { clipId, shotId, transitionId, PROJECT_ID } from './fixtures.js'

/**
 * 一部だけを書き出す（制作者 2026-10-02「途中までを誰かに見せたい時のために選択した Shot だけを動画として出力」）。
 * 区間に掛かるものだけを残し、頭を 0 秒へずらし、端で切る。音楽はその区間の音から鳴らす。
 */

// CUT-1 0–4（動画）/ CUT-2 4–8（動画・2 倍速）/ CUT-3 8–12（絵）。テロップ 3–6 と 9–10。曲 0–12。
const doc: TimelineDocument = {
  version: 1,
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  durationSec: 12,
  video1: [
    { shotId: shotId(1), startSec: 0, durationSec: 4, mediaUrl: 'https://media.test/1.mp4', inSec: 0 },
    { shotId: shotId(2), startSec: 4, durationSec: 4, mediaUrl: 'https://media.test/2.mp4', inSec: 1, playbackRate: 2 },
    { shotId: shotId(3), startSec: 8, durationSec: 4, mediaUrl: 'https://media.test/3.png', inSec: 0, kind: 'image' },
  ],
  transitions: [
    { id: transitionId(1), projectId: PROJECT_ID, fromShotId: shotId(1), toShotId: shotId(2), type: 'dissolve', durationSec: 0.5 },
    { id: transitionId(2), projectId: PROJECT_ID, fromShotId: shotId(2), toShotId: shotId(3), type: 'dissolve', durationSec: 0.5 },
  ],
  clips: [
    { id: clipId(1), track: 'TEXT', startSec: 3, durationSec: 3, layer: 0, opacity: 1, content: { type: 'text', templateKey: 'plain', params: { text: 'あ' } } },
    { id: clipId(2), track: 'TEXT', startSec: 9, durationSec: 1, layer: 0, opacity: 1, content: { type: 'text', templateKey: 'plain', params: { text: 'い' } } },
    {
      id: clipId(3), track: 'VIDEO2', startSec: 3, durationSec: 4, layer: 0, opacity: 1,
      content: { type: 'media', mediaUrl: 'https://media.test/b.mp4', kind: 'video', inSec: 10, outSec: 14, volume: 1 },
    },
  ],
  audio: [{ mediaUrl: 'https://media.test/song.mp3', startSec: 0, durationSec: 12, volume: 1 }],
}

describe('sliceTimelineDocument', () => {
  it('区間に掛かるものだけを残し、頭を 0 秒にする。尺は区間の長さ', () => {
    const sliced = sliceTimelineDocument(doc, { startSec: 4, endSec: 8 })

    expect(sliced.durationSec).toBe(4)
    expect(sliced.video1.map((shot) => [shot.shotId, shot.startSec, shot.durationSec])).toEqual([[shotId(2), 0, 4]])
    expect(sliced.audio).toEqual([{ mediaUrl: 'https://media.test/song.mp3', startSec: 0, durationSec: 4, volume: 1, inSec: 4 }])
  })

  it('頭で切れた動画は切り出し位置が進む（再生速度の分だけ）。絵は進まない', () => {
    const sliced = sliceTimelineDocument(doc, { startSec: 5, endSec: 9 })

    const [moving, still] = sliced.video1
    expect(moving).toMatchObject({ shotId: shotId(2), startSec: 0, durationSec: 3, inSec: 1 + 1 * 2 })
    expect(still).toMatchObject({ shotId: shotId(3), startSec: 3, durationSec: 1, inSec: 0 })
  })

  it('テロップと素材のクリップは端で切る。素材は切り出し位置も合わせる', () => {
    const sliced = sliceTimelineDocument(doc, { startSec: 4, endSec: 6 })

    expect(sliced.clips.map((clip) => [clip.id, clip.startSec, clip.durationSec])).toEqual([
      [clipId(1), 0, 2],
      [clipId(3), 0, 2],
    ])
    expect(sliced.clips[1]?.content).toMatchObject({ inSec: 11, outSec: 13 })
  })

  it('前後の Shot が両方残るトランジションだけを残す', () => {
    expect(sliceTimelineDocument(doc, { startSec: 0, endSec: 8 }).transitions.map((t) => t.id)).toEqual([transitionId(1)])
    expect(sliceTimelineDocument(doc, { startSec: 4, endSec: 8 }).transitions).toEqual([])
  })

  it('区間に掛からないもの（端で触れるだけのものも）は残さない', () => {
    const sliced = sliceTimelineDocument(doc, { startSec: 8, endSec: 12 })

    expect(sliced.video1.map((shot) => shot.shotId)).toEqual([shotId(3)])
    expect(sliced.clips.map((clip) => clip.id)).toEqual([clipId(2)])
  })

  it('もとの文書は変えない', () => {
    const before = JSON.stringify(doc)
    sliceTimelineDocument(doc, { startSec: 5, endSec: 9 })
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('区間が逆・空・尺の外なら投げる（黙って全体にしない）', () => {
    expect(() => sliceTimelineDocument(doc, { startSec: 8, endSec: 4 })).toThrow()
    expect(() => sliceTimelineDocument(doc, { startSec: 4, endSec: 4 })).toThrow()
    expect(() => sliceTimelineDocument(doc, { startSec: -1, endSec: 4 })).toThrow()
    expect(() => sliceTimelineDocument(doc, { startSec: 4, endSec: 13 })).toThrow()
  })
})
