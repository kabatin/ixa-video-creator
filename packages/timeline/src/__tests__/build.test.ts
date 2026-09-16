import { describe, expect, it } from 'vitest'
import { buildTimelineDocument } from '../build.js'
import { makeClip, makeShot, makeSource, shotId, snapshot } from './fixtures.js'

describe('buildTimelineDocument', () => {
  it('VIDEO1 は startSec 昇順に並ぶ', () => {
    const shots = [makeShot(3, 8, 2), makeShot(1, 0, 4), makeShot(2, 4, 4)]
    const document = buildTimelineDocument(makeSource({ shots }))

    expect(document.video1.map((entry) => entry.startSec)).toEqual([0, 4, 8])
    expect(document.video1.map((entry) => entry.shotId)).toEqual([shotId(1), shotId(2), shotId(3)])
  })

  it('採用 Take が無い Shot は VIDEO1 に含めない', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4), makeShot(3, 8, 4)]
    const document = buildTimelineDocument(
      makeSource({
        shots,
        resolveShotMedia: (shot) =>
          shot.id === shotId(2) ? undefined : `https://media.test/${shot.code}.mp4`,
      }),
    )

    expect(document.video1.map((entry) => entry.shotId)).toEqual([shotId(1), shotId(3)])
  })

  it('sourceInSec が inSec に入る（ADR-0011 のトリム位置）', () => {
    const shots = [makeShot(1, 0, 3.75, { sourceInSec: 0.15 })]
    const document = buildTimelineDocument(makeSource({ shots }))

    expect(document.video1[0]?.inSec).toBe(0.15)
    expect(document.video1[0]?.durationSec).toBe(3.75)
  })

  it('尺は Shot の終端で決まる', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 6)]
    expect(buildTimelineDocument(makeSource({ shots })).durationSec).toBe(10)
  })

  it('クリップが Shot より後ろまで伸びていればクリップの終端で決まる', () => {
    const shots = [makeShot(1, 0, 4)]
    const clips = [makeClip(11, 'TEXT', 3, 5)]
    expect(buildTimelineDocument(makeSource({ shots, clips })).durationSec).toBe(8)
  })

  it('音楽が Shot より長ければ音楽の終わりで尺が決まる', () => {
    const shots = [makeShot(1, 0, 4)]
    const musicTracks = [
      { mediaUrl: 'https://media.test/bgm.mp3', startSec: 0, durationSec: 116, volume: 0.8 },
    ]
    expect(buildTimelineDocument(makeSource({ shots, musicTracks })).durationSec).toBe(116)
  })

  it('音楽にオフセットがあれば開始位置 + 尺で終わりが決まる', () => {
    const shots = [makeShot(1, 0, 4)]
    const musicTracks = [
      { mediaUrl: 'https://media.test/bgm.mp3', startSec: 12, durationSec: 20, volume: 0.8 },
    ]
    expect(buildTimelineDocument(makeSource({ shots, musicTracks })).durationSec).toBe(32)
  })

  it('Shot が音楽より長ければ Shot の終わりで尺が決まる', () => {
    const shots = [makeShot(1, 0, 200)]
    const musicTracks = [
      { mediaUrl: 'https://media.test/bgm.mp3', startSec: 0, durationSec: 116, volume: 0.8 },
    ]
    expect(buildTimelineDocument(makeSource({ shots, musicTracks })).durationSec).toBe(200)
  })

  it('音楽の尺がタイムラインの audio に引き継がれる', () => {
    const musicTracks = [
      { mediaUrl: 'https://media.test/bgm.mp3', startSec: 0, durationSec: 116, volume: 0.8 },
    ]
    const doc = buildTimelineDocument(makeSource({ shots: [makeShot(1, 0, 4)], musicTracks }))
    expect(doc.audio[0]?.durationSec).toBe(116)
  })

  it('採用 Take の無い Shot も尺の計算には含める', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 6)]
    const document = buildTimelineDocument(
      makeSource({ shots, resolveShotMedia: () => undefined }),
    )

    expect(document.video1).toEqual([])
    expect(document.durationSec).toBe(10)
  })

  it('クリップを track → layer で安定ソートする', () => {
    const clips = [
      makeClip(21, 'SFX', 0, 1),
      makeClip(22, 'VFX', 0, 1, 2),
      makeClip(23, 'TEXT', 0, 1),
      makeClip(24, 'VFX', 0, 1, 0),
      makeClip(25, 'VIDEO2', 0, 1),
    ]
    const document = buildTimelineDocument(makeSource({ shots: [makeShot(1, 0, 10)], clips }))

    expect(document.clips.map((clip) => [clip.track, clip.layer])).toEqual([
      ['VFX', 0],
      ['VFX', 2],
      ['TEXT', 0],
      ['VIDEO2', 0],
      ['SFX', 0],
    ])
  })

  it('fps と解像度を Project から引き継ぐ', () => {
    const document = buildTimelineDocument(makeSource({ shots: [makeShot(1, 0, 2)] }))

    expect(document.version).toBe(1)
    expect(document.fps).toBe(30)
    expect(document.resolution).toEqual({ width: 1920, height: 1080 })
  })

  it('入力の配列を変更しない', () => {
    const shots = [makeShot(3, 8, 2), makeShot(1, 0, 4), makeShot(2, 4, 4)]
    const clips = [makeClip(21, 'SFX', 0, 1), makeClip(22, 'VFX', 0, 1)]
    const musicTracks = [{ mediaUrl: 'https://media.test/bgm.mp3', startSec: 0, durationSec: 1, volume: 1 }]
    const before = snapshot([shots, clips, musicTracks])

    const document = buildTimelineDocument(makeSource({ shots, clips, musicTracks }))
    expect(document.video1).toHaveLength(3)

    expect(snapshot([shots, clips, musicTracks])).toBe(before)
    expect(shots.map((shot) => shot.code)).toEqual(['S3', 'S1', 'S2'])
    expect(document.clips).not.toBe(clips)
  })
})
