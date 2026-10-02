import {
  ModelId as ModelIdSchema,
  ProviderId as ProviderIdSchema,
  ReferenceRole as ReferenceRoleSchema,
} from '@ixa/domain'
import type {
  ProviderJobStatus, VideoModelCapabilities, VideoModelDescriptor,
  VideoProvider, VideoGenerationRequest,
} from '@ixa/provider-core'

/**
 * テスト用の VideoProvider ダブル。
 * packages/providers/video（スタブ Provider）には依存しない。
 * `@ixa/provider-core` の interface だけを実装する（ADR-0004）。
 */

export const DEFAULT_TEST_CAPABILITIES: VideoModelCapabilities = {
  durations: { mode: 'enum', values: [4, 6, 8] },
  aspectRatios: ['16:9'],
  resolutions: [{ width: 1920, height: 1080 }],
  fps: [30],
  referenceImages: { max: 3, roles: [...ReferenceRoleSchema.options] },
  seed: true,
  negativePrompt: true,
  cameraControl: 'prompt',
  audioGeneration: false,
}

export type TestModelOverrides = {
  readonly id?: string
  readonly providerId?: string
  readonly capabilities?: Partial<VideoModelCapabilities>
  readonly characterConsistency?: number
  readonly costPerSecondUsd?: number
  readonly typicalLatencySec?: number
}

export const testModel = (overrides: TestModelOverrides = {}): VideoModelDescriptor => ({
  id: ModelIdSchema.parse(overrides.id ?? 'test/model-a'),
  providerId: ProviderIdSchema.parse(overrides.providerId ?? 'test'),
  label: overrides.id ?? 'test/model-a',
  capabilities: { ...DEFAULT_TEST_CAPABILITIES, ...overrides.capabilities },
  qualities: {
    characterConsistency: overrides.characterConsistency ?? 0.5,
    motion: 0.5,
    physics: 0.5,
    cameraControl: 0.5,
    promptAdherence: 0.5,
  },
  economics: {
    costPerSecondUsd: overrides.costPerSecondUsd ?? 0.1,
    typicalLatencySec: overrides.typicalLatencySec ?? 60,
  },
})

export type TestProviderBehaviour = {
  /** submit が返す providerJobRef。 */
  readonly ref?: string
  /** poll が順に返す状態。最後の要素はそれ以降も返り続ける。 */
  readonly statuses?: readonly ProviderJobStatus[]
  /** submit が必ず失敗する場合のエラー。 */
  readonly submitError?: Error
  /** cancel が必ず失敗する場合のエラー（生成先に届かない）。 */
  readonly cancelError?: Error
}

export type TestVideoProvider = VideoProvider & {
  readonly submitted: () => readonly VideoGenerationRequest[]
  readonly pollCount: () => number
  /** 止めてと頼まれた providerJobRef。頼まれた順。 */
  readonly cancelled: () => readonly string[]
}

export const createTestVideoProvider = (
  models: readonly VideoModelDescriptor[] = [testModel()],
  behaviour: TestProviderBehaviour = {},
): TestVideoProvider => {
  const submitted: VideoGenerationRequest[] = []
  const cancelled: string[] = []
  let polls = 0

  return {
    id: models[0]?.providerId ?? ProviderIdSchema.parse('test'),
    models,
    submitted: () => submitted,
    pollCount: () => polls,
    cancelled: () => cancelled,

    submit: (request) => {
      if (behaviour.submitError) return Promise.reject(behaviour.submitError)
      submitted.push(request)
      return Promise.resolve({
        providerId: request.model.providerId,
        modelId: request.model.id,
        ref: behaviour.ref ?? 'provider-job-1',
        submittedAt: new Date(),
      })
    },

    poll: () => {
      const statuses = behaviour.statuses ?? []
      const index = Math.min(polls, statuses.length - 1)
      polls += 1
      const status = statuses[index]
      if (status === undefined) {
        return Promise.resolve<ProviderJobStatus>({ state: 'pending', progress: null })
      }
      return Promise.resolve(status)
    },

    cancel: (handle) => {
      cancelled.push(handle.ref)
      return behaviour.cancelError ? Promise.reject(behaviour.cancelError) : Promise.resolve()
    },
  }
}
