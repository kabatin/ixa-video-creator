import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { MediaAssetRepository, ProjectRepository, RenderJobRepository } from '@ixa/db'
import {
  MediaAssetId as MediaAssetIdSchema,
  RenderJobId as RenderJobIdSchema,
  newId,
  type MediaAssetId,
  type Project,
  type RenderJob,
  type RenderResult,
  type TimelineRenderer,
} from '@ixa/domain'
import { renderKey, type ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import { z } from 'zod'
import { createProgressReporter } from './progress.js'

/**
 * render キューのジョブ処理（docs/ARCHITECTURE.md §16 / §20）。
 *
 * - ジョブデータは ID のみ。実データは DB から読む（DB が真実。ADR-0008）
 * - **`RenderJob.timelineSnapshot` をそのまま使い、タイムラインを組み直さない。**
 *   レンダリング中に Shot が編集されても、投入した時点の内容が出る
 * - 冪等。終了済みのジョブを再実行しても MediaAsset を二重に作らない
 */

export const RenderJobData = z.object({ renderJobId: RenderJobIdSchema })
export type RenderJobData = z.infer<typeof RenderJobData>

/** 出力の既定の拡張子と MIME。レンダラは MP4 を返す（ADR-0010）。 */
export const DEFAULT_OUTPUT_EXTENSION = 'mp4'
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
}

export type RenderProcessorDeps = {
  readonly renderJobs: RenderJobRepository
  readonly mediaAssets: MediaAssetRepository
  readonly projects: ProjectRepository
  readonly storage: ObjectStorage
  readonly renderer: TimelineRenderer
  readonly logger: Logger
}

export type RenderOutcome =
  | { readonly state: 'skipped'; readonly reason: string }
  | { readonly state: 'succeeded'; readonly outputAssetId: MediaAssetId }
  | { readonly state: 'failed'; readonly message: string }

/** 作業を続けられない状態。RenderJob.error に落として failed にする。 */
class RenderFailure extends Error {
  override readonly name = 'RenderFailure'
}

const TERMINAL_STATUSES: readonly RenderJob['status'][] = ['succeeded', 'failed', 'cancelled']

const EXTENSION_PATTERN = /^[A-Za-z0-9]{1,8}$/

/** ローカル出力パスから拡張子を取る。判別できなければ mp4 とみなす。 */
export const extensionOf = (path: string, fallback = DEFAULT_OUTPUT_EXTENSION): string => {
  const dot = path.lastIndexOf('.')
  if (dot <= 0 || dot === path.length - 1) return fallback
  const ext = path.slice(dot + 1).toLowerCase()
  return EXTENSION_PATTERN.test(ext) ? ext : fallback
}

/**
 * 進捗を DB へ書く口。
 *
 * `onProgress` は同期関数なので await できない。更新を 1 本のチェーンに繋いで
 * **順序を保ったまま直列化**し、レンダリング完了後に `drain()` で流し切る。
 * 進捗の更新に失敗してもレンダリングは止めない（進捗は本体ではない）。
 */
const createProgressWriter = (deps: RenderProcessorDeps, job: RenderJob) => {
  let chain: Promise<void> = Promise.resolve()

  const report = createProgressReporter({
    onReport: (progress) => {
      chain = chain
        .then(async () => {
          await deps.renderJobs.update(job.id, { progress })
        })
        .catch((error: unknown) => {
          deps.logger.warn({ jobId: job.id, err: error }, '進捗の更新に失敗しました')
        })
    },
  })

  return { report, drain: () => chain }
}

/**
 * 出力ファイルをストレージへ格納し、MediaAsset を作る。
 *
 * `RenderResult.storageKey` は `packages/render` が書いた**ローカルのファイルパス**で、
 * ストレージ上のキーではない（renderer.ts のコメント参照）。ここで置き換える。
 */
const storeOutput = async (
  deps: RenderProcessorDeps,
  job: RenderJob,
  project: Project,
  result: RenderResult,
): Promise<MediaAssetId> => {
  const ext = extensionOf(result.storageKey)
  const key = renderKey(project.id, job.id, ext)
  const contentType = MIME_BY_EXTENSION[ext] ?? 'application/octet-stream'

  const body = await readFile(result.storageKey)
  await deps.storage.put(key, body, { contentType })

  const mediaAssetId = newId(MediaAssetIdSchema)
  const asset = await deps.mediaAssets.create({
    id: mediaAssetId,
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'video',
    storageKey: key,
    mimeType: contentType,
    bytes: body.byteLength,
    checksumSha256: createHash('sha256').update(body).digest('hex'),
    // 解像度やコーデックは ffprobe が測る。ここで preset から推測して書かない。
    probe: {
      durationSec: result.durationSec,
      width: null,
      height: null,
      fps: null,
      hasAudio: job.timelineSnapshot.audio.length > 0,
      codec: null,
    },
    origin: { type: 'rendered', renderJobId: job.id },
    tags: [],
  })

  return asset.id
}

/** レンダリング本体。スナップショットをそのままレンダラへ渡す。 */
const render = async (
  deps: RenderProcessorDeps,
  job: RenderJob,
  project: Project,
): Promise<MediaAssetId> => {
  await deps.renderJobs.update(job.id, { status: 'rendering', progress: 0 })

  const progress = createProgressWriter(deps, job)

  let result: RenderResult
  try {
    // **timelineSnapshot をそのまま渡す。DB から組み直さない。**
    // 組み直すと、レンダリング中の編集が出力に混ざって再現できなくなる。
    result = await deps.renderer.render(job.timelineSnapshot, job.preset, progress.report)
  } finally {
    // 失敗しても、そこまでの進捗は書き切ってから抜ける。
    await progress.drain()
  }

  const outputAssetId = await storeOutput(deps, job, project, result)

  await deps.renderJobs.update(job.id, {
    status: 'succeeded',
    progress: 1,
    outputAssetId,
    error: null,
    finishedAt: new Date(),
  })

  deps.logger.info(
    { jobId: job.id, outputAssetId, durationSec: result.durationSec },
    'レンダリングが完了しました',
  )
  return outputAssetId
}

/**
 * render ジョブを 1 件処理する。終了済みなら何もしない。
 *
 * ジョブデータは `{ renderJobId }` のみ。scope / preset / タイムラインは
 * すべて DB の RenderJob 行から読む。
 */
export const processRenderJob = async (
  deps: RenderProcessorDeps,
  data: unknown,
): Promise<RenderOutcome> => {
  const { renderJobId } = RenderJobData.parse(data)

  const job = await deps.renderJobs.findById(renderJobId)
  if (job === null) throw new Error(`RenderJob が見つかりません: ${renderJobId}`)

  // 冪等性の要。同じジョブが 2 回走っても MediaAsset を二重に作らない。
  if (TERMINAL_STATUSES.includes(job.status)) {
    deps.logger.debug({ jobId: job.id, status: job.status }, '終了済みのジョブなので何もしません')
    return { state: 'skipped', reason: `status=${job.status}` }
  }

  try {
    const project = await deps.projects.findById(job.projectId)
    if (project === null) {
      throw new RenderFailure(`Project がありません: ${job.projectId}`)
    }

    const outputAssetId = await render(deps, job, project)
    return { state: 'succeeded', outputAssetId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    await deps.renderJobs.update(job.id, {
      status: 'failed',
      error: message,
      finishedAt: new Date(),
    })
    deps.logger.error({ jobId: job.id, err: error }, 'レンダリングジョブが失敗しました')
    return { state: 'failed', message }
  }
}
