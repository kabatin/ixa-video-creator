import { join } from 'node:path'
import type {
  CharacterRepository,
  ImageJobRepository,
  MediaAssetRepository,
  ProjectRepository,
  ShotRepository,
} from '@ixa/db'
import {
  compileStartFramePrompt,
  resolveReferences,
  type AspectRatio,
  type GenerationContextSource,
  type ImageGenerationJob,
  type ImageGenerationJobError,
  type MediaAssetId,
  type Project,
  type ProjectEventPublisher,
  type Resolution,
  type Shot,
} from '@ixa/domain'
import { replaceManualStartFrame, type StartFrameReferences } from '@ixa/generation'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import { withTempDir } from '../media/temp-dir.js'
import { generateCharacterSheet } from './character-sheet.js'
import { cropToAspect } from './crop.js'
import { publishImageJobStatus } from './events.js'
import { ImageJobData } from './job-data.js'
import { requestShapeFor } from './shape.js'
import {
  ImageJobCancelled,
  ImageJobFailure,
  ingest,
  localPathOf,
  localReferenceResolver,
  throwIfCancelled,
  waitForResult,
  type ImageAdapter,
  type ImageJobResult,
  type JobDeps,
} from './steps.js'

export type { ImageAdapter, ImageJobResult } from './steps.js'

/**
 * 絵を 1 枚作る（ADR-0029）。種類で分ける: 最初のフレーム（ここ）とキャラクターシート（`character-sheet.ts`。ADR-0035）。
 *
 * 最初のフレーム:
 *
 * 材料を集める（登場人物・衣装・場所の参照と Shot の説明）→ 参照を手元へ落とす → 作る →
 * プロジェクトの比に切り抜く → 素材として取り込む → **最初のフレームを差し替える** → 知らせる。
 * 失敗したら理由を残し、最初のフレームは変えない。
 */
export type ImageProcessorDeps = {
  readonly imageJobs: ImageJobRepository
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  /** キャラクターシートの材料と、できたシートを識別画像に足す先（ADR-0035）。 */
  readonly characters: Pick<CharacterRepository, 'findById' | 'listIdentityImages' | 'addIdentityImage'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById' | 'create'>
  readonly shotReferences: StartFrameReferences
  readonly storage: ObjectStorage
  readonly context: GenerationContextSource
  /**
   * この環境で作れる口。**ジョブに記された口（providerId・modelId）で作る**（ADR-0032）。
   * どの口で作るかは API が「使う AI」から決めてジョブに記す。worker は起動時の設定で選ばない。
   */
  readonly adapters: readonly ImageAdapter[]
  readonly mediaQueue: { readonly enqueue: (mediaAssetId: MediaAssetId) => Promise<void> }
  readonly events: ProjectEventPublisher
  readonly workDir: string
  readonly logger: Logger
  /** 出来上がりを見に行く間隔。既定 2 秒（Codex は 1 枚 70 秒前後）。 */
  readonly pollIntervalMs?: number
  /** 比への切り抜き。テストで ffmpeg を使わないための差し込み口。 */
  readonly crop?: (input: string, output: string, aspect: AspectRatio) => Promise<Resolution>
}

const loadShotAndProject = async (deps: JobDeps, job: ImageGenerationJob): Promise<{ shot: Shot; project: Project }> => {
  const shot = job.shotId === null ? null : await deps.shots.findById(job.shotId)
  const project = shot === null ? null : await deps.projects.findById(shot.projectId)
  if (shot === null || project === null) {
    throw new ImageJobFailure({ code: 'shot_missing', message: 'この Shot は消されました。', retryable: false })
  }
  return { shot, project }
}

const generateStartFrame = async (deps: JobDeps, job: ImageGenerationJob, dir: string): Promise<void> => {
  const { shot, project } = await loadShotAndProject(deps, job)
  const [characters, locations, manualReferences] = await Promise.all([
    deps.context.charactersForShot(shot.id),
    deps.context.locationsForShot(shot.id),
    deps.context.manualReferencesForShot(shot.id),
  ])
  const caps = deps.model.capabilities
  // 最初のフレームと前のカットの最後の 1 コマは渡さない（いま作ろうとしている物そのもの）。
  const references = resolveReferences({
    characters,
    locations,
    manualReferences,
    previousShotLastFrameId: null,
    startFrameId: null,
    // 作品の手本画像（ADR-0030）。1 枚目は人物の次に優先される。
    styleReferenceIds: project.styleReferenceAssetIds,
    maxReferences: caps.referenceImages.max,
    supportedRoles: caps.referenceImages.roles,
  })
  const running = await deps.imageJobs.markRunning(job.id, references.map((reference) => reference.mediaAssetId))
  // 拾ってから作り始めるまでの間に止められた（止めた行は上書きされずに返ってくる）。
  if (running.status === 'cancelled') throw new ImageJobCancelled(job.id)
  await publishImageJobStatus(deps, running)

  const shape = requestShapeFor(deps.model, project.aspectRatio)
  const handle = await deps.provider.submit({
    model: deps.model,
    prompt: compileStartFramePrompt({ project, shot, characters, references }),
    negativePrompt: null,
    resolution: shape.resolution,
    aspectRatio: shape.aspectRatio,
    seed: null,
    references: references.map(({ mediaAssetId, role }) => ({ mediaAssetId, role })),
    resolveReference: localReferenceResolver(deps, dir),
    count: 1,
  })
  const cropped = join(dir, 'start-frame.png')
  const raw = await (async () => {
    try {
      const result = await waitForResult(deps, handle, job.id)
      const output = result.outputs[0]
      if (output === undefined) {
        throw new ImageJobFailure({ code: 'no_image', message: '絵が返ってきませんでした。', retryable: true }, result.raw)
      }
      await (deps.crop ?? cropToAspect)(localPathOf(output), cropped, project.aspectRatio)
      return result.raw
    } finally {
      // 手元に置いた出力（Codex の作業ディレクトリ）は、切り抜いて写したらもう要らない。失敗しても片付ける。
      await deps.provider.release?.(handle)
    }
  })()
  // 絵が届いた後に止められたら、取り込まず差し替えない（止めたのに絵が変わらないように）。
  await throwIfCancelled(deps, job.id)
  const mediaAssetId = await ingest(deps, project, job, cropped)
  await replaceManualStartFrame(deps.shotReferences, shot.id, mediaAssetId)
  const succeeded = await deps.imageJobs.markSucceeded(job.id, mediaAssetId, raw)
  await deps.mediaQueue.enqueue(mediaAssetId)
  await publishImageJobStatus(deps, succeeded)
}

const describeUnexpected = (error: unknown): ImageGenerationJobError => ({
  code: 'unexpected',
  message: `絵を作れませんでした: ${error instanceof Error ? error.message : String(error)}`,
  retryable: true,
})

export const processImageJob = async (deps: ImageProcessorDeps, data: unknown): Promise<ImageJobResult> => {
  const { imageJobId } = ImageJobData.parse(data)
  const job = await deps.imageJobs.findById(imageJobId)
  if (job === null) {
    deps.logger.warn({ imageJobId }, '絵のジョブが見つかりません')
    return { state: 'missing' }
  }
  // 終わったジョブと、人が止めたジョブは作らない。
  if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') return { state: 'skipped' }

  try {
    const adapter = deps.adapters.find(
      (candidate) => candidate.model.providerId === job.providerId && candidate.model.id === job.modelId,
    )
    if (adapter === undefined) {
      throw new ImageJobFailure({
        code: 'provider_unavailable',
        message: `この環境では「${job.modelId}」で絵を作れません。「使う AI」で画像の AI を選び直してください。`,
        retryable: false,
      })
    }
    const generate = job.kind === 'character_sheet' ? generateCharacterSheet : generateStartFrame
    await withTempDir(deps.workDir, 'image-', (dir) => generate({ ...deps, ...adapter }, job, dir))
    return { state: 'succeeded' }
  } catch (error) {
    // 人が止めた。失敗ではないので理由を書かずに手を引く（止めた行はそのまま。画面へは止めた側が知らせている）。
    if (error instanceof ImageJobCancelled) {
      deps.logger.info({ imageJobId, kind: job.kind, shotId: job.shotId }, '止められた絵のジョブから手を引きました')
      return { state: 'skipped' }
    }
    // **握り潰さない。** 理由をジョブに残して画面へ出し、ログにも残す。最初のフレームは変えない。
    const failure = error instanceof ImageJobFailure ? error.failure : describeUnexpected(error)
    deps.logger.error(
      { imageJobId, kind: job.kind, shotId: job.shotId, characterId: job.characterId, code: failure.code, err: error },
      '絵を作れませんでした',
    )
    const failed = await deps.imageJobs.markFailed(job.id, failure, error instanceof ImageJobFailure ? error.record : null)
    await publishImageJobStatus(deps, failed)
    return { state: 'failed' }
  }
}
