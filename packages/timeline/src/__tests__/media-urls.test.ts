import { MediaAssetId, type TimelineDocument } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { buildTimelineDocument } from '../build.js'
import { videoAssetIdsOf, withMediaUrls } from '../media-urls.js'
import { makeMediaClip, makeShot, makeSource, shotId, snapshot } from './fixtures.js'

/**
 * 書き出しの直前に、拡大した映像へ URL を差し替える（ADR-0045）。
 * **分からないもの（素材 ID が無い・絵コンテの画像）は触らない。**
 */
const A = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1')
const B = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA2')
const CLIP_ASSET = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')

const documentOf = (): TimelineDocument =>
  buildTimelineDocument(
    makeSource({
      shots: [makeShot(1, 0, 4), makeShot(2, 4, 4), makeShot(3, 8, 4), makeShot(4, 12, 4)],
      // 3 は Take が無く絵だけ。
      resolveShotMedia: (shot) => (shot.id === shotId(3) ? undefined : `https://media.test/${shot.code}.mp4`),
      resolveShotStill: (shot) => `https://media.test/${shot.code}.png`,
      // 1 と 4 は同じ素材（重複を数えない）。2 は B。
      resolveShotMediaAssetId: (shot) => (shot.id === shotId(2) ? B : A),
      clips: [makeMediaClip(1, 'VIDEO2', 0, 2)],
    }),
  )

describe('videoAssetIdsOf', () => {
  it('映像の素材 ID を重複なしで出てきた順に返す（絵コンテの画像は入れない）', () => {
    expect(videoAssetIdsOf(documentOf())).toEqual([A, B, CLIP_ASSET])
  })

  it('素材 ID の無い文書（前からの書き出しの記録）からは何も返さない', () => {
    const doc = buildTimelineDocument(makeSource({ shots: [makeShot(1, 0, 4)] }))
    expect(videoAssetIdsOf(doc)).toEqual([])
  })
})

describe('withMediaUrls', () => {
  it('表にある素材だけ URL を差し替える', () => {
    const doc = documentOf()
    const out = withMediaUrls(doc, new Map([[A, 'http://127.0.0.1:9/a']]))

    expect(out.video1.map((entry) => entry.mediaUrl)).toEqual([
      'http://127.0.0.1:9/a',
      'https://media.test/S2.mp4',
      'https://media.test/S3.png',
      'http://127.0.0.1:9/a',
    ])
  })

  it('絵コンテの画像は、ID が表にあっても触らない', () => {
    const doc = documentOf()
    const out = withMediaUrls(doc, new Map([[A, 'x'], [B, 'y']]))
    expect(out.video1[2]?.mediaUrl).toBe('https://media.test/S3.png')
  })

  it('表が空なら同じ文書をそのまま返す（書き出しの経路を変えない）', () => {
    const doc = documentOf()
    expect(withMediaUrls(doc, new Map())).toBe(doc)
  })

  it('元の文書を書き換えない', () => {
    const doc = documentOf()
    const before = snapshot([doc])
    withMediaUrls(doc, new Map([[A, 'x'], [CLIP_ASSET, 'y']]))
    expect(snapshot([doc])).toBe(before)
  })
})
