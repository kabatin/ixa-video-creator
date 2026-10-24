import type { TimelineDocument } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { muteMusic } from '@/lib/mute-music'

/** プレビューで曲だけ消す（2026-10-24、制作者「効果音だけ確認しやすいように」）。 */

const doc = {
  audio: [
    { mediaUrl: 'bgm.wav', startSec: 0, durationSec: 20, volume: 0.8 },
    { mediaUrl: 'bgm2.wav', startSec: 0, durationSec: 20, volume: 1, role: 'music' },
    { mediaUrl: 'line.wav', startSec: 2, durationSec: 3, volume: 1, role: 'voice' },
  ],
  clips: [{ id: 'sfx' }],
} as unknown as TimelineDocument

describe('muteMusic', () => {
  it('曲（role 無しも曲）だけ音量 0。声と効果音（clips）はそのまま、尺の手がかりは外さない', () => {
    const muted = muteMusic(doc)
    expect(muted.audio.map((track) => track.volume)).toEqual([0, 0, 1])
    expect(muted.audio.map((track) => track.durationSec)).toEqual([20, 20, 3])
    expect(muted.clips).toBe(doc.clips)
  })

  it('元の文書は変えない', () => {
    muteMusic(doc)
    expect(doc.audio[0]?.volume).toBe(0.8)
  })
})
