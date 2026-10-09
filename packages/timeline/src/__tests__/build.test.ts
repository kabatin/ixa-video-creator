import { MediaAssetId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { buildTimelineDocument } from '../build.js'
import { makeClip, makeMediaClip, makeShot, makeSource, shotId, snapshot } from './fixtures.js'

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

  /**
   * Take が無く絵コンテの画像（最初のフレーム）がある Shot は、その絵を Shot の尺だけ映す
   * （制作者 2026-10-02「画像しかない場合、プレビューでは画像が出るんじゃなかったっけ？」。書き出しにも入れる）。
   */
  it('採用 Take が無く絵がある Shot は、絵を VIDEO1 に載せる（速度・切り出し位置は持たない）', () => {
    const shots = [makeShot(1, 0, 4), makeShot(2, 4, 4, { sourceInSec: 0.3, timing: 'fit' }), makeShot(3, 8, 4)]
    const document = buildTimelineDocument(
      makeSource({
        shots,
        resolveShotMedia: (shot) => (shot.id === shotId(2) ? undefined : `https://media.test/${shot.code}.mp4`),
        resolveShotMediaDurationSec: () => 3,
        resolveShotStill: (shot) => `https://media.test/${shot.code}.png`,
      }),
    )

    expect(document.video1.map((entry) => entry.shotId)).toEqual([shotId(1), shotId(2), shotId(3)])
    expect(document.video1[1]).toEqual({
      shotId: shotId(2),
      startSec: 4,
      durationSec: 4,
      mediaUrl: 'https://media.test/S2.png',
      inSec: 0,
      kind: 'image',
    })
    // 動画の Shot は今までと同じ形（kind を書かない）。
    expect(document.video1[0]).not.toHaveProperty('kind')
  })

  it('採用 Take があれば、絵があっても Take を映す', () => {
    const document = buildTimelineDocument(
      makeSource({
        shots: [makeShot(1, 0, 4)],
        resolveShotStill: (shot) => `https://media.test/${shot.code}.png`,
      }),
    )

    expect(document.video1[0]?.mediaUrl).toBe('https://media.test/S1.mp4')
    expect(document.video1[0]).not.toHaveProperty('kind')
  })

  /**
   * ADR-0045。書き出しの直前に、大きさが Project と違う素材だけを拡大する。
   * 大きさを引くには素材 ID が要る（文書の URL からは引けない）。
   */
  describe('素材 ID（書き出しの直前の拡大に使う）', () => {
    const ASSET = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW')

    it('引ける口があれば、採用 Take の素材 ID を載せる', () => {
      const document = buildTimelineDocument(
        makeSource({ shots: [makeShot(1, 0, 4)], resolveShotMediaAssetId: () => ASSET }),
      )
      expect(document.video1[0]?.mediaAssetId).toBe(ASSET)
    })

    it('口が無ければ載せない（文書は今までと同じ形）', () => {
      const document = buildTimelineDocument(makeSource({ shots: [makeShot(1, 0, 4)] }))
      expect(document.video1[0]).not.toHaveProperty('mediaAssetId')
    })

    it('絵コンテの画像には載せない（拡大の対象ではない）', () => {
      const document = buildTimelineDocument(
        makeSource({
          shots: [makeShot(1, 0, 4)],
          resolveShotMedia: () => undefined,
          resolveShotStill: (shot) => `https://media.test/${shot.code}.png`,
          resolveShotMediaAssetId: () => ASSET,
        }),
      )
      expect(document.video1[0]?.kind).toBe('image')
      expect(document.video1[0]).not.toHaveProperty('mediaAssetId')
    })

    it('メディアのクリップは DB のクリップが持つ素材 ID を載せる', () => {
      const document = buildTimelineDocument(makeSource({ clips: [makeMediaClip(1, 'VIDEO2', 0, 4)] }))
      expect(document.clips[0]?.content).toMatchObject({
        type: 'media',
        mediaAssetId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      })
    })
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

describe('クリップのメディア解決', () => {
  it('解決できたクリップは URL と種別を持つ', () => {
    const clips = [makeMediaClip(1, 'VIDEO2', 0, 2)]
    const doc = buildTimelineDocument(makeSource({ shots: [makeShot(1, 0, 4)], clips }))
    const content = doc.clips[0]?.content
    expect(content?.type).toBe('media')
    if (content?.type === 'media') {
      expect(content.mediaUrl).toContain('https://media.test/')
      expect(content.kind).toBe('video')
    }
  })

  it('効果音のフェードを書き出しの材料に写す（無ければ付けない）', () => {
    const faded = makeMediaClip(1, 'SFX', 0, 2)
    const clips = [
      { ...faded, content: { ...faded.content, fadeInSec: 0.2, fadeOutSec: 0.5 } } as typeof faded,
      makeMediaClip(2, 'SFX', 2, 1),
    ]
    const doc = buildTimelineDocument(makeSource({ shots: [makeShot(1, 0, 4)], clips }))
    expect(doc.clips[0]?.content).toMatchObject({ fadeInSec: 0.2, fadeOutSec: 0.5 })
    expect(doc.clips[1]?.content).not.toHaveProperty('fadeInSec')
  })

  it('解決できないクリップは消さず unresolved として残す', () => {
    const clips = [makeMediaClip(1, 'VIDEO2', 0, 2)]
    const doc = buildTimelineDocument(
      makeSource({ shots: [makeShot(1, 0, 4)], clips, resolveClipMedia: () => undefined }),
    )
    expect(doc.clips).toHaveLength(1)
    const content = doc.clips[0]?.content
    expect(content?.type).toBe('unresolved')
    if (content?.type === 'unresolved') {
      expect(content.reason).toContain('解決できません')
    }
  })

  it('text クリップはメディア解決を経由しない', () => {
    const clips = [makeClip(2, 'TEXT', 0, 2)]
    const doc = buildTimelineDocument(
      makeSource({ shots: [makeShot(1, 0, 4)], clips, resolveClipMedia: () => undefined }),
    )
    expect(doc.clips[0]?.content.type).toBe('text')
  })
})

/** 尺に合わせた速度（ADR-0026）。プレビューと書き出しが同じ値を読む。 */
describe('再生速度', () => {
  it('fit の Shot は Take の長さから速度を決める', () => {
    const shots = [makeShot(1, 0, 5, { timing: 'fit' })]
    const document = buildTimelineDocument(makeSource({ shots, resolveShotMediaDurationSec: () => 4 }))

    expect(document.video1[0]?.playbackRate).toBeCloseTo(0.8, 9)
  })

  it('trim の Shot には速度を書かない（今の文書と同じ形のまま）', () => {
    const shots = [makeShot(1, 0, 5)]
    const document = buildTimelineDocument(makeSource({ shots, resolveShotMediaDurationSec: () => 4 }))

    expect(document.video1[0]).not.toHaveProperty('playbackRate')
  })

  it('Take の長さを引けなければ速度を書かない', () => {
    const shots = [makeShot(1, 0, 5, { timing: 'fit' })]
    const document = buildTimelineDocument(makeSource({ shots }))

    expect(document.video1[0]).not.toHaveProperty('playbackRate')
  })
})
