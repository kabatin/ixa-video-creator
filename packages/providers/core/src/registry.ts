import type { ModelId, ProviderId } from '@ixa/domain'
import type { VideoModelDescriptor, VideoProvider } from './provider.js'

export class UnknownModelError extends Error {
  constructor(readonly modelId: ModelId) {
    super(`未登録のモデルです: ${modelId}`)
    this.name = 'UnknownModelError'
  }
}

/**
 * Provider 実装を app 層で束ねる。Domain は Registry に依存しない（ADR-0004）。
 */
export type ProviderRegistry = {
  readonly providers: readonly VideoProvider[]
  allModels(): readonly VideoModelDescriptor[]
  findModel(modelId: ModelId): VideoModelDescriptor
  providerFor(modelId: ModelId): VideoProvider
  hasProvider(providerId: ProviderId): boolean
}

export const createProviderRegistry = (providers: readonly VideoProvider[]): ProviderRegistry => {
  const modelIndex = new Map<string, { model: VideoModelDescriptor; provider: VideoProvider }>()

  for (const provider of providers) {
    for (const model of provider.models) {
      if (modelIndex.has(model.id)) {
        throw new Error(`モデル ID が重複しています: ${model.id}`)
      }
      modelIndex.set(model.id, { model, provider })
    }
  }

  return {
    providers,
    allModels: () => [...modelIndex.values()].map((e) => e.model),
    findModel: (modelId) => {
      const entry = modelIndex.get(modelId)
      if (!entry) throw new UnknownModelError(modelId)
      return entry.model
    },
    providerFor: (modelId) => {
      const entry = modelIndex.get(modelId)
      if (!entry) throw new UnknownModelError(modelId)
      return entry.provider
    },
    hasProvider: (providerId) => providers.some((p) => p.id === providerId),
  }
}
