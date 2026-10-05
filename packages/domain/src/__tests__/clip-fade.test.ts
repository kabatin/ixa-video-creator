import { describe, expect, it } from 'vitest'
import { MediaAssetId, newId } from '../common/ids.js'
import { CLIP_FADE_MAX_SEC, TimelineClipContent } from '../timeline/timeline.js'

/** 効果音のフェード（ADR-0039）。省けば付けない（前からあるクリップはそのまま読める）。 */

const media = (patch: Record<string, unknown> = {}) =>
  TimelineClipContent.parse({ type: 'media', mediaAssetId: newId(MediaAssetId), inSec: 0, outSec: 2, ...patch })

describe('音のクリップのフェード', () => {
  it('省けば付けない（既定値を足さない）', () => {
    expect(media()).not.toHaveProperty('fadeInSec')
    expect(media()).not.toHaveProperty('fadeOutSec')
  })

  it(`0〜${String(CLIP_FADE_MAX_SEC)} 秒を受け、それを超える・負の値は断る`, () => {
    expect(media({ fadeInSec: 0.5, fadeOutSec: CLIP_FADE_MAX_SEC })).toMatchObject({ fadeInSec: 0.5, fadeOutSec: CLIP_FADE_MAX_SEC })
    expect(() => media({ fadeInSec: CLIP_FADE_MAX_SEC + 0.01 })).toThrow()
    expect(() => media({ fadeOutSec: -1 })).toThrow()
  })
})
