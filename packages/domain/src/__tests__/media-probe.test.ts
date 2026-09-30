import { describe, expect, it } from 'vitest'
import { MediaProbe } from '../media/media-asset.js'

const STORED_BEFORE_VIDEO_DURATION = {
  durationSec: 3,
  width: 320,
  height: 240,
  fps: 10,
  hasAudio: true,
  codec: 'h264',
}

describe('MediaProbe', () => {
  it('videoDurationSec が無い保存済みの probe もそのまま読める', () => {
    expect(MediaProbe.parse(STORED_BEFORE_VIDEO_DURATION)).toEqual(STORED_BEFORE_VIDEO_DURATION)
  })

  it('映像ストリームの尺を durationSec とは別に持てる', () => {
    const probe = MediaProbe.parse({ ...STORED_BEFORE_VIDEO_DURATION, videoDurationSec: 1 })
    expect(probe.durationSec).toBe(3)
    expect(probe.videoDurationSec).toBe(1)
  })

  it('負の videoDurationSec を拒否する', () => {
    expect(() =>
      MediaProbe.parse({ ...STORED_BEFORE_VIDEO_DURATION, videoDurationSec: -1 }),
    ).toThrow()
  })
})
