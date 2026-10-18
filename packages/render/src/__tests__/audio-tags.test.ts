import { describe, expect, it } from 'vitest'
import { DEFAULT_SHARED_AUDIO_TAGS, peakMountedAudio, sharedAudioTagsFor } from '../audio-tags.js'
import { buildTimelinePlan } from '../plan.js'
import { makeClip, makeDocument, mediaContent } from './fixtures.js'

const CANVAS = { width: 1920, height: 1080 }
const PREMOUNT_FRAMES = 30

const music = (startSec: number, durationSec: number) => ({
  mediaUrl: 'https://media.test/music',
  startSec,
  durationSec,
  inSec: 0,
  volume: 1,
})

const planOf = (doc: ReturnType<typeof makeDocument>) => buildTimelinePlan(doc, CANVAS)

describe('peakMountedAudio', () => {
  it('音が無ければ 0', () => {
    expect(peakMountedAudio(planOf(makeDocument()), PREMOUNT_FRAMES)).toBe(0)
  })

  it('曲 1 本と、重なる効果音 5 本で 6（戦子の TT-07 で止まった形）', () => {
    const sfx = [24.08, 24.18, 24.47, 24.72, 25.05].map((start, i) =>
      makeClip(i + 1, 'SFX', start, 0.4, 0, mediaContent('audio')),
    )
    const doc = makeDocument({ durationSec: 32, audio: [music(0, 32)], clips: sfx })
    expect(peakMountedAudio(planOf(doc), PREMOUNT_FRAMES)).toBe(6)
  })

  it('始まる前の組み立て（premount）の間も数える', () => {
    // 2 本目は 1 本目が終わった 0.5 秒後に始まるが、1 秒前から組み立てるので重なる。
    const doc = makeDocument({
      durationSec: 4,
      clips: [
        makeClip(1, 'SFX', 0, 1, 0, mediaContent('audio')),
        makeClip(2, 'SFX', 1.5, 1, 0, mediaContent('audio')),
      ],
    })
    expect(peakMountedAudio(planOf(doc), PREMOUNT_FRAMES)).toBe(2)
    expect(peakMountedAudio(planOf(doc), 0)).toBe(1)
  })

  it('音でないクリップ（絵・動画・テロップ）は数えない', () => {
    const doc = makeDocument({
      clips: [
        makeClip(1, 'VIDEO2', 0, 2, 0, mediaContent('video')),
        makeClip(2, 'VIDEO2', 0, 2, 1, mediaContent('image')),
        makeClip(3, 'TEXT', 0, 2),
        makeClip(4, 'SFX', 0, 2, 0, mediaContent('audio')),
      ],
    })
    expect(peakMountedAudio(planOf(doc), PREMOUNT_FRAMES)).toBe(1)
  })
})

describe('sharedAudioTagsFor', () => {
  it('少なければ Remotion の既定（5）のまま', () => {
    expect(sharedAudioTagsFor(0)).toBe(DEFAULT_SHARED_AUDIO_TAGS)
    expect(sharedAudioTagsFor(3)).toBe(DEFAULT_SHARED_AUDIO_TAGS)
  })

  it('必要な数より必ず多い（ちょうどだと次の 1 本で止まる）', () => {
    for (let peak = 0; peak <= 40; peak += 1) expect(sharedAudioTagsFor(peak)).toBeGreaterThan(peak)
  })

  it('4 刻みに丸める（少し足しただけで Player を作り直さない）', () => {
    expect(sharedAudioTagsFor(6)).toBe(8)
    expect(sharedAudioTagsFor(7)).toBe(12)
    expect(sharedAudioTagsFor(9)).toBe(12)
  })
})
