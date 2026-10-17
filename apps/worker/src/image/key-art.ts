import { join } from 'node:path'
import { compileKeyArtPrompt, pickKeyArtReferences, type ImageGenerationJob } from '@ixa/domain'
import { cropToAspect } from './crop.js'
import { publishImageJobStatus } from './events.js'
import { requestShapeFor } from './shape.js'
import {
  ImageJobCancelled,
  ImageJobFailure,
  ingest,
  localPathOf,
  localReferenceResolver,
  throwIfCancelled,
  waitForResult,
  type JobDeps,
} from './steps.js'

/**
 * サムネイルの背景（キーアート）を作る（ADR-0051）。Shot にもキャラクターにも属さず、作品にだけ属する。
 *
 * 材料を集める（作品の方針・コンセプト・登場人物とその顔の画像）→ 横長 16:9 で作る → 16:9 に切り抜く →
 * 素材として取り込む → 知らせる。**最初のフレームも識別画像も変えない**（候補の 1 枚を足すだけ。選ぶのは人）。
 */

/** YouTube のサムネイルの比。 */
const KEY_ART_ASPECT = '16:9'

const loadMaterials = async (deps: JobDeps, job: ImageGenerationJob) => {
  const project = await deps.projects.findById(job.projectId)
  if (project === null) {
    throw new ImageJobFailure({ code: 'project_missing', message: 'この作品は消されました。', retryable: false })
  }
  const [concept, characters] = await Promise.all([deps.concept(project.id), deps.characters.findByProject(project.id)])
  const cast = await Promise.all(
    characters.map(async (character) => ({
      character,
      identityImages: await deps.characters.listIdentityImages(character.id),
    })),
  )
  return { project, concept, cast }
}

export const generateKeyArt = async (deps: JobDeps, job: ImageGenerationJob, dir: string): Promise<void> => {
  const { project, concept, cast } = await loadMaterials(deps, job)
  const references = pickKeyArtReferences({
    cast,
    styleReferenceIds: project.styleReferenceAssetIds,
    maxReferences: deps.model.capabilities.referenceImages.max,
  })
  const running = await deps.imageJobs.markRunning(job.id, references)
  // 拾ってから作り始めるまでの間に止められた（止めた行は上書きされずに返ってくる）。
  if (running.status === 'cancelled') throw new ImageJobCancelled(job.id)
  await publishImageJobStatus(deps, running)

  const shape = requestShapeFor(deps.model, KEY_ART_ASPECT)
  const handle = await deps.provider.submit({
    model: deps.model,
    prompt: compileKeyArtPrompt({
      project,
      concept,
      cast: cast.map(({ character }) => character),
      instruction: job.instruction,
    }),
    negativePrompt: null,
    resolution: shape.resolution,
    aspectRatio: shape.aspectRatio,
    seed: null,
    // 人物の顔の画像は人物として、作品の手本画像は見た目の手本として渡す。
    references: references.map((mediaAssetId) => ({
      mediaAssetId,
      role: project.styleReferenceAssetIds.includes(mediaAssetId) ? ('style' as const) : ('subject' as const),
    })),
    resolveReference: localReferenceResolver(deps, dir),
    count: 1,
    // 投げ直しても二重に作らせない（手元の生成サーバが使う。ADR-0047）。
    idempotencyKey: job.id,
  })
  const cropped = join(dir, 'key-art.png')
  const raw = await (async () => {
    try {
      const result = await waitForResult(deps, handle, job.id)
      const output = result.outputs[0]
      if (output === undefined) {
        throw new ImageJobFailure({ code: 'no_image', message: '絵が返ってきませんでした。', retryable: true }, result.raw)
      }
      await (deps.crop ?? cropToAspect)(localPathOf(output), cropped, KEY_ART_ASPECT)
      return result.raw
    } finally {
      await deps.provider.release?.(handle)
    }
  })()
  // 届いた後に止められたら、取り込まない。
  await throwIfCancelled(deps, job.id)
  const mediaAssetId = await ingest(deps, project, job, cropped)
  const succeeded = await deps.imageJobs.markSucceeded(job.id, mediaAssetId, raw)
  await deps.mediaQueue.enqueue(mediaAssetId)
  await publishImageJobStatus(deps, succeeded)
}
