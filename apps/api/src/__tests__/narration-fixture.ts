import { OpenAPIHono } from '@hono/zod-openapi'
import type { VoiceJobId, VoiceToolId } from '@ixa/domain'
import type { VoiceAdapter } from '@ixa/provider-core'
import { createStubVoice } from '@ixa/provider-voice'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import type { NarrationDeps } from '../narration/deps.js'
import { narrationRoutes } from '../routes/narration.js'
import { aProject } from './fixtures.js'
import {
  createInMemoryAudioSettingsRepository,
  createInMemoryNarrationLineRepository,
  createInMemoryNarrationTakeRepository,
  createInMemoryVoiceJobRepository,
  createInMemoryVoiceProfileRepository,
} from '@ixa/generation/testing'
import { createInMemoryProjectEvents } from './in-memory-project-events.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/** ナレーションの API（ADR-0038）のテスト用の組み立て。実 DB・実 AI には繋がない。 */

export type Ok<T> = { success: true; data: T }
export type Err = { success: false; error: string; fields?: Record<string, string[]> }

export const setupNarration = (
  options: {
    readonly adapters?: Partial<Record<VoiceToolId, VoiceAdapter>>
    /** 声 1 回の見積もり（USD）。既定 0（お試し）。 */
    readonly costPerSpeak?: number
    readonly budgetUsd?: number | null
    readonly enqueueFails?: boolean
  } = {},
) => {
  const project = aProject({ budgetUsd: options.budgetUsd === undefined ? 500 : options.budgetUsd })
  const enqueued: VoiceJobId[] = []
  const events = createInMemoryProjectEvents()
  const voiceJobs = createInMemoryVoiceJobRepository()
  const logger = createLogger('silent')
  const other = aProject({ name: '別の作品' })
  const projects = createInMemoryProjectRepository([project, other])
  const deps = {
    projects,
    voices: createInMemoryVoiceProfileRepository(),
    lines: createInMemoryNarrationLineRepository(),
    takes: createInMemoryNarrationTakeRepository(),
    voiceJobs,
    audioSettings: createInMemoryAudioSettingsRepository(),
    voiceAdapter: (tool: VoiceToolId) => (options.adapters ?? { stub: createStubVoice() })[tool] ?? null,
    voiceQueue: {
      enqueue: (id) => {
        if (options.enqueueFails === true) return Promise.reject(new Error('Redis に繋がりません'))
        enqueued.push(id)
        return Promise.resolve()
      },
    },
    spentByProject: (projectId) => voiceJobs.sumCostByProject(projectId),
    speakCostEstimate: () => options.costPerSpeak ?? 0,
    events,
    logger,
  } satisfies NarrationDeps
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', narrationRoutes(deps))
  registerErrorHandlers(app, logger)

  const send = (method: string, path: string, payload?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
  return { app, deps, project, other, send, enqueued, events }
}

export const json = async <T>(res: Response): Promise<T> => (await res.json()) as T
