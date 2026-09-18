import { GenerationJobId, ProjectId, ShotId, TakeId, type ProjectEvent } from '@ixa/domain'

export const PROJECT_A = ProjectId.parse('01JBQK8Z0000000000000000AA')
export const PROJECT_B = ProjectId.parse('01JBQK8Z0000000000000000BB')
const SHOT = ShotId.parse('01JBQK8Z0000000000000000S1')
const JOB = GenerationJobId.parse('01JBQK8Z0000000000000000J1')
const TAKE = TakeId.parse('01JBQK8Z0000000000000000T1')

export const shotStatusEvent = (projectId = PROJECT_A): ProjectEvent => ({
  type: 'shot.status',
  projectId,
  at: '2026-09-18T00:00:00.000Z',
  shotId: SHOT,
  status: 'generating',
})

export const jobStatusEvent = (projectId = PROJECT_A): ProjectEvent => ({
  type: 'generation_job.status',
  projectId,
  at: '2026-09-18T00:00:01.000Z',
  shotId: SHOT,
  jobId: JOB,
  status: 'succeeded',
  takeId: TAKE,
  error: null,
})

/** 型では作れない壊れた出来事。API / worker から実際に来うる形（種別の綴り違い）。 */
export const brokenEvent = (): ProjectEvent =>
  ({
    type: 'shot.statuses',
    projectId: PROJECT_A,
    at: '2026-09-18T00:00:00.000Z',
    shotId: SHOT,
    status: 'generating',
  }) as unknown as ProjectEvent
