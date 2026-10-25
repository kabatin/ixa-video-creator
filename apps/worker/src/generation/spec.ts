import {
  compileSpec,
  computeSpecHash,
  generationSecFor,
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
 *
 * **直し（corrections）だけは Shot から導けない。** 人が生成のたびに選ぶものなので
 * `GenerationJob.corrections` の行を唯一の正として受け取る。
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
  corrections: readonly string[] = [],
  /**
   * 使うシード（ADR-0042）。**行から渡す。** `corrections` と同じで、
   * api が仕様へ織り込んだ値をここでも渡さないと `specHash` が一致せず `spec_drift` で落ちる。
   * 既定の `null` は「Provider に任せる」。
   */
  seed: number | null = null,
): Promise<RebuiltSpec> => {
  const [characters, locations, manualReferences, previousShotLastFrameId, startFrameId, speakers] =
    await Promise.all([
      context.charactersForShot(shot.id),
      context.locationsForShot(shot.id),
      context.manualReferencesForShot(shot.id),
      context.previousShotLastFrame(shot.id),
      context.startFrame(shot.id),
      // セリフの話し手（ADR-0059）。api と同じ口から読む（違うと spec_drift で落ちる）。
      context.speakersForShot(shot.id),
    ])

  const caps = model.capabilities
  const references = resolveReferences({
    characters,
    locations,
    manualReferences,
    previousShotLastFrameId,
    startFrameId,
    // 作品の手本画像（ADR-0030）。受け付ける映像モデルにだけ届く（役割 style）。
    styleReferenceIds: project.styleReferenceAssetIds,
    maxReferences: caps.referenceImages.max,
    supportedRoles: caps.referenceImages.roles,
  })

  const spec = compileSpec({
    project,
    shot,
    characters,
    references,
    // 頼む長さ（尺 × 速さ。ADR-0050）をモデルの対応値へ切り上げる（ADR-0011）。
    generationDurationSec: generationSecFor(shot, caps.durations),
    seed,
    negativePrompt: null,
    /**
     * **直しは GenerationJob の行から渡す。** api が仕様へ織り込んだものと
     * 同じ値をここでも渡さないと `specHash` が一致せず `spec_drift` で落ちる（L-012）。
     */
    corrections,
    speakers,
  })

  return { spec, specHash: await computeSpecHash(spec) }
}
