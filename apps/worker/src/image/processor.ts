import { join } from 'node:path'
import type {
  CharacterRepository,
  ImageCheckRepository,
  ImageJobRepository,
  MediaAssetRepository,
  ProjectRepository,
  ShotRepository,
} from '@ixa/db'
import {
  compileStartFramePrompt,
  resolveReferences,
  type AiSettings,
  type AspectRatio,
  type GenerationContextSource,
  type ImageGenerationJob,
  type ImageGenerationJobError,
  type ImageJobKind,
  type MediaAssetId,
  type Project,
  type ProjectEventPublisher,
  type ProjectId,
  type Resolution,
  type Shot,
} from '@ixa/domain'
import type { StartFrameReferences } from '@ixa/generation'
import type { ImageChecker } from '@ixa/provider-llm'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import type { LocalGpuLease } from '../generation/local-gpu-lease.js'
import { withTempDir } from '../media/temp-dir.js'
import { generateCharacterSheet } from './character-sheet.js'
import { processImageCheck } from './check-step.js'
import { generateKeyArt } from './key-art.js'
import { cropToAspect } from './crop.js'
import { publishImageJobStatus } from './events.js'
import { ImageJobData } from './job-data.js'
import { holdLocalGpu, releaseCancelledLocalGpuTurn, takeLocalGpuTurn } from './local-gpu.js'
import { requestShapeFor } from './shape.js'
import {
  finishDrawing,
  ImageJobCancelled,
  ImageJobFailure,
  ingest,
  localPathOf,
  localReferenceResolver,
  throwIfCancelled,
  waitForResult,
  withRetryDelta,
  type ImageAdapter,
  type ImageJobResult,
  type JobDeps,
} from './steps.js'

export type { ImageAdapter, ImageJobResult } from './steps.js'

/**
 * 絵を 1 枚作る（ADR-0029）。種類で分ける: 最初のフレーム（ここ）・キャラクターシート（`character-sheet.ts`。ADR-0035）・
 * キーアート（`key-art.ts`。ADR-0051）。
 *
 * 最初のフレーム:
 *
 * 材料を集める（登場人物・衣装・場所の参照と Shot の説明）→ 参照を手元へ落とす → 作る →
 * プロジェクトの比に切り抜く → 素材として取り込む → チェックへ回す（ADR-0055）→ 知らせる。
 * 最初のフレームを差し替えるのは、チェックの手順がつながりの最後に 1 回だけ（`check-step.ts`）。
 * 失敗したら理由を残し、最初のフレームは変えない。
 */
export type ImageProcessorDeps = {
  readonly imageJobs: ImageJobRepository
  /** 作った絵のチェック（ADR-0055）。 */
  readonly imageChecks: ImageCheckRepository
  /** 絵を見る口（Claude CLI）。絵のチェックを入れていて、文章の AI が Claude のときだけ使う（ADR-0066）。 */
  readonly checker: ImageChecker
  /** いま選んでいる文章の AI と AI のチェック（ADR-0032・0066）。チェックするたびに読む。 */
  readonly checkSettings: () => Promise<Pick<AiSettings, 'text' | 'checks'>>
  /** 自動のやり直しの上限（回数。既定 2）。 */
  readonly maxRetries: number
  /** image キューへ積む口。描く手順（やり直し）とチェックの手順。 */
  readonly queue: {
    readonly draw: (imageJobId: ImageGenerationJob['id']) => Promise<void>
    readonly check: (imageJobId: ImageGenerationJob['id']) => Promise<void>
  }
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  /** キャラクターシートの材料と、できたシートを識別画像に足す先（ADR-0035）。 */
  readonly characters: Pick<CharacterRepository, 'findById' | 'findByProject' | 'listIdentityImages' | 'addIdentityImage'>
  /** 作品のコンセプト・あらすじ（脚本のいまの版）。キーアートの指示に入れる（ADR-0051）。無ければ空文字。 */
  readonly concept: (projectId: ProjectId) => Promise<string>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById' | 'create'>
  readonly shotReferences: StartFrameReferences
  readonly storage: ObjectStorage
  readonly context: GenerationContextSource
  /**
   * この環境で作れる口。**ジョブに記された口（providerId・modelId）で作る**（ADR-0032）。
   * どの口で作るかは API が「使う AI」から決めてジョブに記す。worker は起動時の設定で選ばない。
   */
  readonly adapters: readonly ImageAdapter[]
  /**
   * 手元の GPU の順番（整理券。ADR-0047）。`exclusiveResource: 'local-gpu'` を名乗る口（klein）だけが並ぶ。
   * **省略できない形にする。** 省略できると、配線し忘れたとき動画と同時に GPU を使い始める。
   */
  readonly localGpuLease: LocalGpuLease
  /** 順番が来ていない絵を、時間を置いて積み直す口（ADR-0047。待つ間 worker の処理枠を握らない）。 */
  readonly scheduler: { readonly reschedule: (data: ImageJobData, delayMs: number) => Promise<void> }
  /** 借りを延ばす間隔。テストで短くするための差し込み口（既定 1 分）。 */
  readonly gpuRenewIntervalMs?: number
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

/** 開始フレームの材料と指示。描くときとチェックするときが同じものを使う。 */
export const startFrameMaterials = async (deps: JobDeps, job: ImageGenerationJob) => {
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
  return { shot, project, references, prompt: compileStartFramePrompt({ project, shot, characters, references }) }
}

const generateStartFrame = async (deps: JobDeps, job: ImageGenerationJob, dir: string): Promise<void> => {
  const { project, references, prompt } = await startFrameMaterials(deps, job)
  const running = await deps.imageJobs.markRunning(job.id, references.map((reference) => reference.mediaAssetId))
  // 拾ってから作り始めるまでの間に止められた（止めた行は上書きされずに返ってくる）。
  if (running.status === 'cancelled') throw new ImageJobCancelled(job.id)
  await publishImageJobStatus(deps, running)

  const shape = requestShapeFor(deps.model, project.aspectRatio)
  // 送る文そのもの（やり直しの直し方を足した後）。できた絵の記録に残す（プロンプトビューア）。
  const sentPrompt = await withRetryDelta(deps, job, prompt)
  const handle = await deps.provider.submit({
    model: deps.model,
    prompt: sentPrompt,
    negativePrompt: null,
    resolution: shape.resolution,
    aspectRatio: shape.aspectRatio,
    seed: null,
    references: references.map(({ mediaAssetId, role }) => ({ mediaAssetId, role })),
    resolveReference: localReferenceResolver(deps, dir),
    count: 1,
    // 投げ直しても二重に作らせない（手元の生成サーバが使う。ADR-0047）。
    idempotencyKey: job.id,
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
  await finishDrawing(deps, job, await ingest(deps, project, job, cropped), raw, sentPrompt)
}

const describeUnexpected = (error: unknown): ImageGenerationJobError => ({
  code: 'unexpected',
  message: `絵を作れませんでした: ${error instanceof Error ? error.message : String(error)}`,
  retryable: true,
})

/** 種類ごとの作り方。種類が増えたらここが型エラーになる（黙って最初のフレームとして作らない）。 */
const generatorFor = (kind: ImageJobKind): ((deps: JobDeps, job: ImageGenerationJob, dir: string) => Promise<void>) => {
  switch (kind) {
    case 'start_frame':
      return generateStartFrame
    case 'character_sheet':
      return generateCharacterSheet
    case 'key_art':
      return generateKeyArt
  }
}

export const processImageJob = async (deps: ImageProcessorDeps, data: unknown): Promise<ImageJobResult> => {
  const { imageJobId, step } = ImageJobData.parse(data)
  const job = await deps.imageJobs.findById(imageJobId)
  if (job === null) {
    deps.logger.warn({ imageJobId }, '絵のジョブが見つかりません')
    return { state: 'missing' }
  }
  const adapter = deps.adapters.find(
    (candidate) => candidate.model.providerId === job.providerId && candidate.model.id === job.modelId,
  )
  // 作った絵のチェックと、当てる・やり直すの判断（ADR-0055）。GPU の順番は持たない。
  if (step === 'check') return processImageCheck(deps, adapter, job)
  // 描き終えてチェックへ回したジョブ（描く手順の投げ直し）。描き直さず、チェックの手順をもう一度積む（冪等）。
  if (job.status === 'checking') {
    await deps.queue.check(job.id)
    return { state: 'skipped' }
  }
  // 終わったジョブと、人が止めたジョブは作らない。
  if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
    // 順番待ちの間に止められたジョブは、券を列に残したまま手を引かない（後ろの GPU の仕事が 15 分待たされる）。
    if (job.status === 'cancelled' && adapter?.provider.exclusiveResource === 'local-gpu') {
      await releaseCancelledLocalGpuTurn(deps, job)
    }
    return { state: 'skipped' }
  }

  try {
    if (adapter === undefined) {
      throw new ImageJobFailure({
        code: 'provider_unavailable',
        message: `この環境では「${job.modelId}」で絵を作れません。「使う AI」で画像の AI を選び直してください。`,
        retryable: false,
      })
    }
    const generate = generatorFor(job.kind)
    const work = (): Promise<void> => withTempDir(deps.workDir, 'image-', (dir) => generate({ ...deps, ...adapter }, job, dir))
    if (adapter.provider.exclusiveResource !== 'local-gpu') {
      await work()
      return { state: 'succeeded' }
    }
    // 手元の GPU を使う口（ADR-0047）。順番が来ていなければ積み直して手を離す（ジョブは queued のまま）。
    const turn = await takeLocalGpuTurn(deps, job)
    if (turn.state === 'wait') {
      await deps.scheduler.reschedule({ imageJobId: job.id }, turn.delayMs)
      return { state: 'waiting' }
    }
    await holdLocalGpu(deps, job, work)
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
    // やり直しが失敗したら、前までの絵から選んで当てる（ADR-0055 §7）。
    if (failed.status === 'failed' && failed.retryOfJobId !== null) {
      await deps.queue.check(failed.id).catch((enqueueError: unknown) => {
        deps.logger.error({ imageJobId, err: enqueueError }, 'やり直しの失敗のあと、前の絵を当てる手順を積めませんでした')
      })
    }
    return { state: 'failed' }
  }
}
