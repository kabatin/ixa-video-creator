import {
  compileSpec,
  computeSpecHash,
  quantizeDuration,
  resolveReferences,
  type GenerationContextSource,
  type Project,
  type Shot,
  type ShotGenerationSpec,
} from '@ixa/domain'
import type { VideoModelDescriptor } from '@ixa/provider-core'

/**
 * GenerationJob から生成仕様を組み直す。
 *
 * キューには ID しか乗っていないため、仕様は毎回 DB の Shot / Project と
 * 参照 Port から決定的に組み直す（DB が真実。ADR-0008）。
 * モデルは API が決めて `GenerationJob.resolvedModel` に入っているので、
 * ここでルーターは動かさない。
 */
export type RebuiltSpec = {
  readonly spec: ShotGenerationSpec
  readonly specHash: string
}

export const rebuildSpec = async (
  context: GenerationContextSource,
  shot: Shot,
  project: Project,
  model: VideoModelDescriptor,
): Promise<RebuiltSpec> => {
  const [characters, locations, manualReferences, previousShotLastFrameId, startFrameId] =
    await Promise.all([
      context.charactersForShot(shot.id),
      context.locationsForShot(shot.id),
      context.manualReferencesForShot(shot.id),
      context.previousShotLastFrame(shot.id),
      context.startFrame(shot.id),
    ])

  const caps = model.capabilities
  const references = resolveReferences({
    characters,
    locations,
    manualReferences,
    previousShotLastFrameId,
    startFrameId,
    maxReferences: caps.referenceImages.max,
    supportedRoles: caps.referenceImages.roles,
  })

  const spec = compileSpec({
    project,
    shot,
    characters,
    references,
    // 編集尺をモデルの対応値へ切り上げる（ADR-0011）。
    generationDurationSec: quantizeDuration(shot.durationSec, caps.durations),
    seed: null,
    negativePrompt: null,
  })

  return { spec, specHash: await computeSpecHash(spec) }
}
