import { describe, expect, it } from 'vitest'
import { effectsOmittedBy } from '../ffmpeg-renderer.js'
import { clipId, makeClip, makeDocument, mediaContent } from './fixtures.js'

/** ffmpeg の退避レンダラはエフェクトを描かない。**黙って落とさず**、落ちたものを並べる（ADR-0050）。 */
describe('effectsOmittedBy', () => {
  const doc = makeDocument({
    clips: [
      makeClip(1, 'VFX', 0, 1, 0, { type: 'motion_graphics', templateKey: 'flash', params: {} }),
      makeClip(2, 'VIDEO2', 0, 1, 0, mediaContent('video')),
      makeClip(3, 'VFX', 1, 1, 0, { type: 'motion_graphics', templateKey: 'shake', params: {} }),
    ],
  })

  it('クリップ単位のエフェクトを描けないレンダラでは、エフェクトのクリップを並べる', () => {
    expect(effectsOmittedBy(doc, { motionGraphics: false, textAnimation: false, perClipEffects: false })).toEqual([
      { clipId: clipId(1), templateKey: 'flash' },
      { clipId: clipId(3), templateKey: 'shake' },
    ])
  })

  it('描けるレンダラでは空', () => {
    expect(effectsOmittedBy(doc, { motionGraphics: true, textAnimation: false, perClipEffects: true })).toEqual([])
  })
})
