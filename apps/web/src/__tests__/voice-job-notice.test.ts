import { ProjectEvent, type VoiceJobKind, type VoiceJobStatus } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { voiceJobNotice } from '@/lib/voice-job-notice'

/** 声のジョブ（ADR-0038）が失敗したら、何を作れなかったかと理由を上の知らせに出す（「遅い」と「失敗」を分ける）。 */

const event = (kind: VoiceJobKind, status: VoiceJobStatus, error: string | null = null) => {
  const parsed = ProjectEvent.parse({
    type: 'voice_job.status',
    projectId: '01J9ZK3V8Q4W6N2T5R7Y1X3C9A',
    at: '2026-10-05T00:00:00.000Z',
    jobId: '01J9ZK3V8Q4W6N2T5R7Y1X3C9B',
    kind,
    lineId: null,
    status,
    error,
  })
  if (parsed.type !== 'voice_job.status') throw new Error('声のジョブの出来事ではありません')
  return parsed
}

describe('voiceJobNotice', () => {
  it('失敗は、何を作れなかったかと理由を言う', () => {
    expect(voiceJobNotice(event('speak', 'failed', 'Gemini の回数の上限に達しました'))).toBe('声を作れませんでした: Gemini の回数の上限に達しました')
    expect(voiceJobNotice(event('preview', 'failed', 'x'))).toBe('試しに読めませんでした: x')
    expect(voiceJobNotice(event('transcribe', 'failed', 'x'))).toBe('録音を文字起こしできませんでした: x')
    expect(voiceJobNotice(event('char_timing', 'failed', 'x'))).toBe('字の時刻を取れませんでした: x')
  })

  it('理由が届かなければ、そう言う', () => {
    expect(voiceJobNotice(event('speak', 'failed'))).toBe('声を作れませんでした: 理由が届きませんでした。')
  })

  it('失敗でなければ知らせない', () => {
    expect(voiceJobNotice(event('speak', 'succeeded'))).toBeNull()
    expect(voiceJobNotice(event('speak', 'running'))).toBeNull()
  })
})
