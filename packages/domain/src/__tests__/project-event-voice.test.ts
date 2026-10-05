import { describe, expect, it } from 'vitest'
import { NarrationLineId, ProjectId, VoiceJobId, newId } from '../common/ids.js'
import { ProjectEvent, SHOT_LIST_EVENT_TYPES } from '../events/project-event.js'

/** 声のジョブの出来事（ADR-0038）。行の声ができた・失敗した・止めたを画面へ知らせる。 */
describe('voice_job.status', () => {
  it('ジョブ・種類・行・状態・失敗の理由を持つ', () => {
    const event = {
      type: 'voice_job.status',
      projectId: newId(ProjectId),
      at: new Date().toISOString(),
      jobId: newId(VoiceJobId),
      kind: 'speak',
      lineId: newId(NarrationLineId),
      status: 'succeeded',
      error: null,
    }
    expect(ProjectEvent.parse(event)).toEqual(event)
  })

  it('画面が受け取る出来事に入っている', () => {
    expect(SHOT_LIST_EVENT_TYPES).toContain('voice_job.status')
  })
})
