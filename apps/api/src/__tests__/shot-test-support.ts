import { createProviderRegistry } from '@ixa/provider-core'
import type { Project, Shot } from '@ixa/domain'
import { createApp, type AppDeps } from '../app.js'
import { baseAppDeps, createRecordingQueue, type RecordingQueue } from './app-deps.js'
import { aProject } from './fixtures.js'
import { aShot, aTake, createInMemoryShotRepository, createInMemoryTakeRepository } from '@ixa/generation/testing'
import { createInMemoryGenerationJobRepository } from './in-memory-generation-job-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createTestVideoProvider, testModel } from './test-video-provider.js'

/** Shot 系 API テストで共有するヘルパ。ここにテストは書かない。 */

export type Ok<T> = { success: true; data: T }
export type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }
export type GenerateData = {
  jobIds: string[]
  specHash: string
  resolvedModel: string
  duplicateOfTakeId: string | null
}

export const CHEAP_MODEL = testModel({ id: 'test/cheap', costPerSecondUsd: 0.01, characterConsistency: 0.1 })
export const GOOD_MODEL = testModel({ id: 'test/good', costPerSecondUsd: 0.5, characterConsistency: 0.9 })

export type FixtureOptions = {
  project?: Project
  extraShots?: readonly Shot[]
  takes?: readonly ReturnType<typeof aTake>[]
}

/** Shot / Project を積んだアプリ一式。返り値から偽物リポジトリを覗ける。 */
export const buildFixture = (options: FixtureOptions = {}) => {
  const project: Project = options.project ?? aProject()
  const shot = aShot(project.id)
  const shots = createInMemoryShotRepository([shot, ...(options.extraShots ?? [])])
  const takes = createInMemoryTakeRepository(options.takes ?? [])
  const generationJobs = createInMemoryGenerationJobRepository()
  const queue: RecordingQueue = createRecordingQueue()

  const deps: AppDeps = {
    ...baseAppDeps(),
    projects: createInMemoryProjectRepository([project]),
    shots,
    takes,
    generationJobs,
    registry: createProviderRegistry([createTestVideoProvider([CHEAP_MODEL, GOOD_MODEL])]),
    generationQueue: queue,
  }

  return { app: createApp(deps), project, shot, shots, takes, generationJobs, queue }
}

export const postJson = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
