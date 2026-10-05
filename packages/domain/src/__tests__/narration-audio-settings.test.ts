import { describe, expect, it } from 'vitest'
import { ProjectId, VoiceJobId, newId } from '../common/ids.js'
import { DUCKING_DEPTH_DB } from '../audio/mix.js'
import { MediaOrigin } from '../media/media-asset.js'
import { ProjectAudioSettings, defaultAudioSettings } from '../narration/audio-settings.js'

/** 作品ごとの音の設定（ADR-0038・0039）。読み辞書と、ナレーションの間に BGM を下げる設定。 */
describe('ProjectAudioSettings', () => {
  const projectId = newId(ProjectId)

  it('まだ設定していない作品は、辞書が空・ダッキングはオンで中', () => {
    expect(defaultAudioSettings(projectId)).toEqual({
      projectId,
      readingDictionary: [],
      ducking: { enabled: true, depthDb: DUCKING_DEPTH_DB.medium, attackSec: 0.15, releaseSec: 0.4 },
    })
  })

  it('同じ言葉に読みが 2 つある辞書は受け付けない', () => {
    const result = ProjectAudioSettings.safeParse({
      ...defaultAudioSettings(projectId),
      readingDictionary: [
        { written: '戦子', reading: 'せんこ' },
        { written: '戦子', reading: 'いくさこ' },
      ],
    })
    expect(result.success).toBe(false)
  })
})

describe('MediaOrigin', () => {
  it('AI で作った声は、声のジョブを出どころに持つ', () => {
    const voiceJobId = newId(VoiceJobId)
    expect(MediaOrigin.parse({ type: 'generated_voice', voiceJobId })).toEqual({ type: 'generated_voice', voiceJobId })
  })
})
