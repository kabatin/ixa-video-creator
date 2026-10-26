import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildTimelineDocument } from '../build.js'
import { makeShot, makeSource } from './fixtures.js'
import { MV_SOURCE } from './mv-fixture.js'

/** ADR-0060: 採用 Take の音を鳴らす Shot だけが video1 に `audio` を持つ。 */

const golden = (): unknown =>
  JSON.parse(readFileSync(new URL('./golden/mv-without-dialogue.timeline.json', import.meta.url), 'utf8'))

describe('セリフの無い MV は前と同じ文書になる', () => {
  it('0057 を通った Shot（消音）は、Take に音があっても文書が丸ごと前と同じ', () => {
    // 前の版の buildTimelineDocument で同じ入力から書き出したもの。
    expect(JSON.parse(JSON.stringify(buildTimelineDocument(MV_SOURCE)))).toEqual(golden())
  })
})

describe('Take の音', () => {
  const hasAudio = (codes: readonly string[]) => (shot: { readonly code: string }) => codes.includes(shot.code)

  it('Take に音があり消音していなければ、大きさを付けて鳴らす', () => {
    const doc = buildTimelineDocument(
      makeSource({
        shots: [makeShot(1, 0, 2, { takeAudioVolume: 1.5 })],
        resolveShotMediaHasAudio: hasAudio(['S1']),
      }),
    )
    expect(doc.video1[0]?.audio).toEqual({ volume: 1.5 })
  })

  it('消音した Shot・音の無い Take・大きさ 0 は鳴らさない（欄を書かない）', () => {
    const doc = buildTimelineDocument(
      makeSource({
        shots: [
          makeShot(1, 0, 2, { takeAudioMuted: true }),
          makeShot(2, 2, 2),
          makeShot(3, 4, 2, { takeAudioVolume: 0 }),
        ],
        resolveShotMediaHasAudio: hasAudio(['S1', 'S3']),
      }),
    )
    expect(doc.video1.map((item) => 'audio' in item)).toEqual([false, false, false])
  })

  it('音の有無を引けなければ鳴らさない（A/B 比較など）', () => {
    const doc = buildTimelineDocument(makeSource({ shots: [makeShot(1, 0, 2)] }))
    expect('audio' in (doc.video1[0] ?? {})).toBe(false)
  })

  it('絵コンテの画像には音が無い', () => {
    const doc = buildTimelineDocument(
      makeSource({
        shots: [makeShot(1, 0, 2)],
        resolveShotMedia: () => undefined,
        resolveShotStill: () => 'https://media.test/S1.png',
        resolveShotMediaHasAudio: () => true,
      }),
    )
    expect(doc.video1[0]?.kind).toBe('image')
    expect('audio' in (doc.video1[0] ?? {})).toBe(false)
  })
})
