import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ImageJobRepository,
  MediaAssetRepository,
  ProjectRepository,
  ShotRepository,
} from '@ixa/db'
import {
  compileStartFramePrompt,
  MediaAssetId as MediaAssetIdSchema,
  newId,
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
import type { ImageJobStatus, ImageModelDescriptor, ImageProvider, ProviderOutput } from '@ixa/provider-core'
import { mediaKey, type ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import { withTempDir } from '../media/temp-dir.js'
import { cropToAspect } from './crop.js'
import { publishImageJobStatus } from './events.js'
import { ImageJobData } from './job-data.js'
import { requestShapeFor } from './shape.js'

/**
 * 絵コンテの画像を 1 枚作る（ADR-0029）。
 *
 * 材料を集める（登場人物・衣装・場所の参照と Shot の説明）→ 参照を手元へ落とす → 作る →
 * プロジェクトの比に切り抜く → 素材として取り込む → **最初のフレームを差し替える** → 知らせる。
 * 失敗したら理由を残し、最初のフレームは変えない。
 */
export type ImageProcessorDeps = {
  readonly imageJobs: ImageJobRepository
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById' | 'create'>
  readonly shotReferences: StartFrameReferences
  readonly storage: ObjectStorage
  readonly context: GenerationContextSource
  readonly provider: ImageProvider
  readonly model: ImageModelDescriptor
  readonly mediaQueue: { readonly enqueue: (mediaAssetId: MediaAssetId) => Promise<void> }
  readonly events: ProjectEventPublisher
  readonly workDir: string
  readonly logger: Logger
  /** 出来上がりを見に行く間隔。既定 2 秒（Codex は 1 枚 70 秒前後）。 */
  readonly pollIntervalMs?: number
  /** 比への切り抜き。テストで ffmpeg を使わないための差し込み口。 */
  readonly crop?: (input: string, output: string, aspect: AspectRatio) => Promise<Resolution>
}

export type ImageJobResult = { readonly state: 'succeeded' | 'failed' | 'skipped' | 'missing' }

/** Provider の時間切れ（5 分）より長く待たない。ここを越えるのは Provider 側の異常。 */
const MAX_WAIT_MS = 10 * 60 * 1000
const DEFAULT_POLL_INTERVAL_MS = 2_000

class ImageJobFailure extends Error {
  constructor(readonly failure: ImageGenerationJobError, readonly record: Record<string, unknown> | null = null) {
    super(failure.message)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const loadShotAndProject = async (deps: ImageProcessorDeps, job: ImageGenerationJob): Promise<{ shot: Shot; project: Project }> => {
  const shot = await deps.shots.findById(job.shotId)
  const project = shot === null ? null : await deps.projects.findById(shot.projectId)
  if (shot === null || project === null) {
    throw new ImageJobFailure({ code: 'shot_missing', message: 'この Shot は消されました。', retryable: false })
  }
  return { shot, project }
}

/** 参照を手元のファイルへ落とす（Codex CLI には手元のファイルしか渡せない。署名付き URL も作らない）。 */
const localReferenceResolver =
  (deps: ImageProcessorDeps, dir: string) =>
  async (id: MediaAssetId): Promise<string> => {
    const asset = await deps.mediaAssets.findById(id)
    if (asset === null) {
      throw new ImageJobFailure({ code: 'reference_missing', message: '参照の画像が見つかりませんでした。', retryable: false })
    }
    const extension = asset.storageKey.split('.').at(-1) ?? 'png'
    const path = join(dir, `ref-${id}.${extension}`)
    await writeFile(path, await deps.storage.get(asset.storageKey))
    return path
  }

type Handle = Parameters<ImageProvider['poll']>[0]

const waitForResult = async (
  deps: ImageProcessorDeps,
  handle: Handle,
): Promise<Extract<ImageJobStatus, { state: 'succeeded' }>> => {
  const deadline = Date.now() + MAX_WAIT_MS
  for (;;) {
    const status = await deps.provider.poll(handle)
    if (status.state === 'succeeded') return status
    if (status.state === 'failed') throw new ImageJobFailure(status.error)
    if (Date.now() > deadline) {
      throw new ImageJobFailure({ code: 'timeout', message: '絵が 10 分で仕上がりませんでした。', retryable: true })
    }
    await sleep(deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
  }
}

/**
 * 手元にできた絵のパス。今の Provider（Codex・スタブ）はどちらも手元に置く。
 * URL で返す Provider を繋ぐときは、SSRF の歯止めがある `downloadToStorage` を通すこと（素の fetch をしない）。
 */
const localPathOf = (output: ProviderOutput): string => {
  if (output.type === 'local') return output.path
  throw new ImageJobFailure({ code: 'unsupported_output', message: '作った絵を受け取れませんでした（手元に置かれていません）。', retryable: false })
}

/** 切り抜いた PNG を素材として保存する。出どころはこのジョブ。 */
const ingest = async (deps: ImageProcessorDeps, project: Project, job: ImageGenerationJob, path: string): Promise<MediaAssetId> => {
  const body = await readFile(path)
  const id = newId(MediaAssetIdSchema)
  const storageKey = mediaKey(project.workspaceId, id, 'png')
  await deps.storage.put(storageKey, body, { contentType: 'image/png' })
  await deps.mediaAssets.create({
    id,
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'image',
    storageKey,
    mimeType: 'image/png',
    bytes: body.byteLength,
    checksumSha256: createHash('sha256').update(body).digest('hex'),
    origin: { type: 'generated_image', imageJobId: job.id },
  })
  return id
}

const generate = async (deps: ImageProcessorDeps, job: ImageGenerationJob, dir: string): Promise<void> => {
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
      const result = await waitForResult(deps, handle)
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
    deps.logger.warn({ imageJobId }, '絵コンテの画像ジョブが見つかりません')
    return { state: 'missing' }
  }
  if (job.status === 'succeeded' || job.status === 'failed') return { state: 'skipped' }

  try {
    await withTempDir(deps.workDir, 'image-', (dir) => generate(deps, job, dir))
    return { state: 'succeeded' }
  } catch (error) {
    // **握り潰さない。** 理由をジョブに残して画面へ出し、ログにも残す。最初のフレームは変えない。
    const failure = error instanceof ImageJobFailure ? error.failure : describeUnexpected(error)
    deps.logger.error({ imageJobId, shotId: job.shotId, code: failure.code, err: error }, '絵コンテの画像を作れませんでした')
    const failed = await deps.imageJobs.markFailed(job.id, failure, error instanceof ImageJobFailure ? error.record : null)
    await publishImageJobStatus(deps, failed)
    return { state: 'failed' }
  }
}
