import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
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
import type { LoudnessMeasurement } from '@ixa/media'
import { PRESET_SETTINGS, presetResolution } from '@ixa/render'
import { renderKey, type ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { PrepareMedia } from './prepare-media.js'
import { createProgressReporter } from './progress.js'

/**
 * render キューのジョブ処理（docs/ARCHITECTURE.md §16 / §20）。
 *
 * - ジョブデータは ID のみ。実データは DB から読む（DB が真実。ADR-0008）
 * - **`RenderJob.timelineSnapshot` をそのまま使い、タイムラインを組み直さない。**
 *   レンダリング中に Shot が編集されても、投入した時点の内容が出る
 * - 冪等。終了済みのジョブを再実行しても MediaAsset を二重に作らない
 * - **出力の probe は書かない。** 実測は media ジョブの ffprobe に任せる（`storeOutput` 参照）
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

/**
 * レンダリング結果の MediaAsset を media キューへ回す口。
 *
 * **レンダリング結果にも probe と派生物が要る。** render は出力を測らないので
 * （`storeOutput` のコメント参照）、ここを通さないと尺も解像度も永久に null のまま、
 * ポスターフレームもサムネイルもプロキシも 1 つも作られない。
 *
 * 形は `generation` 側の `MediaJobQueue` と同じだが、render が generation に
 * 依存しないよう別に定義する。配線側は同じオブジェクトを両方へ渡してよい。
 */
export type RenderMediaJobQueue = {
  enqueue(mediaAssetId: MediaAssetId): Promise<void>
}

export type RenderProcessorDeps = {
  readonly renderJobs: RenderJobRepository
  readonly mediaAssets: MediaAssetRepository
  readonly projects: ProjectRepository
  readonly storage: ObjectStorage
  readonly renderer: TimelineRenderer
  readonly mediaQueue: RenderMediaJobQueue
  readonly logger: Logger
  /**
   * 書き出しの音量を揃える（ADR-0039。`@ixa/media` の normalizeProgramLoudness）。揃えた後の大きさを返す。
   * 音が無ければ書かずに null。テストで ffmpeg を使わないための差し込み口。
   */
  readonly normalizeLoudness: (input: string, output: string, audioBitrate: string) => Promise<LoudnessMeasurement | null>
  /**
   * 書き出しの直前に、枠より小さい映像だけ Lanczos で拡大する（ADR-0045 段 3）。
   * 拡大が要る素材が無ければ文書をそのまま返す（いまの素材はすべてそう）。
   */
  readonly prepareMedia: PrepareMedia
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
 *
 * **probe は付けない。** render はこのファイルを一度も測っていない。
 * 以前は尺と hasAudio だけ入れた probe を書いていたが、どちらも実測ではなく
 * 「タイムラインがそう要求した」という入力側の値でしかなかった
 * （エンコードが尺を丸めても、音声トラックが無音で落ちても気づけない）。
 * 残りの width / height / fps / codec は null 固定だった。
 * 実測は media ジョブの ffprobe が行い、`MediaAsset.probe` を後から埋める。
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
  const checksumSha256 = createHash('sha256').update(body).digest('hex')

  /**
   * **中身がまったく同じ書き出しが既にあれば、それを使う。** 素材の表は同じ中身を 1 つしか持てない
   * （`checksum_sha256` の一意制約）ので、作り直すと保存で落ちていた。書き出しは決定的で、
   * タイムラインを変えずにもう一度書き出せば同じバイト列になる（2026-10-09 に実際に当たった）。
   * 同じ中身なので、前のものを指せば何も失わない。置き場にも書かない（同じファイルを 2 つ置かない）。
   */
  const existing = await deps.mediaAssets.findByChecksum(checksumSha256)
  if (existing !== null) {
    deps.logger.info(
      { jobId: job.id, mediaAssetId: existing.id },
      '前の書き出しと中身が同じだったので、前の素材をそのまま使います',
    )
    return existing.id
  }

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
    checksumSha256,
    origin: { type: 'rendered', renderJobId: job.id },
    tags: [],
  })

  return asset.id
}

/**
 * 出力を media キューへ回す。**失敗してもレンダリングジョブは落とさない。**
 *
 * ここに来た時点でレンダリングは終わり、ファイルはストレージに入り、
 * MediaAsset も確定している。Redis の一時的な不調でそれを failed にすると、
 * 数十分かけた出力を捨てて丸ごとやり直すことになる。
 * media ジョブは冪等なので後から流し直せる。
 *
 * ただし黙って落とさない。流し直す対象が分かるよう mediaAssetId ごと error で残す。
 */
const enqueueIngest = async (
  deps: RenderProcessorDeps,
  job: RenderJob,
  mediaAssetId: MediaAssetId,
): Promise<void> => {
  try {
    await deps.mediaQueue.enqueue(mediaAssetId)
  } catch (error) {
    deps.logger.error(
      { jobId: job.id, mediaAssetId, err: error },
      'media キューへ投入できませんでした。出力の probe とポスターフレームが作られていません',
    )
  }
}

/**
 * 書き出しの音量を揃える（ADR-0039）。揃えないと選んだ書き出し・音が無い書き出しは、そのまま使う。
 * **揃えられなければ、黙って揃えないまま出さず失敗にする**（作り直すときに「揃えない」を選べる）。
 */
const normalizeOutput = async (
  deps: RenderProcessorDeps,
  job: RenderJob,
  result: RenderResult,
): Promise<{ readonly output: RenderResult; readonly loudnessLufs: number | null }> => {
  if (!job.normalizeLoudness) return { output: result, loudnessLufs: null }
  const normalizedPath = `${result.storageKey}.loudnorm.mp4`
  let measured: LoudnessMeasurement | null
  try {
    measured = await deps.normalizeLoudness(result.storageKey, normalizedPath, PRESET_SETTINGS[job.preset].audioBitrate)
  } catch (error) {
    throw new RenderFailure(`音量を揃えられませんでした（${error instanceof Error ? error.message : String(error)}）。「音量を揃える」を外して書き出し直せます`)
  }
  if (measured === null) return { output: result, loudnessLufs: null }
  const bytes = (await stat(normalizedPath)).size
  return {
    output: { ...result, storageKey: normalizedPath, bytes },
    loudnessLufs: Number.isFinite(measured.integratedLufs) ? Math.round(measured.integratedLufs * 10) / 10 : null,
  }
}

/** レンダリング本体。スナップショットをそのままレンダラへ渡す。 */
const render = async (
  deps: RenderProcessorDeps,
  job: RenderJob,
  project: Project,
): Promise<MediaAssetId> => {
  await deps.renderJobs.update(job.id, { status: 'rendering', progress: 0 })

  const progress = createProgressWriter(deps, job)

  // **timelineSnapshot から組む。DB から組み直さない。**
  // 組み直すと、レンダリング中の編集が出力に混ざって再現できなくなる。
  // 変えるのは、枠より小さい映像の URL を手元で拡大したものへ差し替えることだけ（ADR-0045）。
  const prepared = await deps.prepareMedia(job.timelineSnapshot, presetResolution(job.preset))

  let result: RenderResult
  try {
    result = await deps.renderer.render(prepared.document, job.preset, progress.report)
  } finally {
    // 失敗しても、そこまでの進捗は書き切ってから抜ける。
    await progress.drain()
    // 片付けの失敗で書き出しの結果（や本当の失敗理由）を上書きしない。
    await prepared.release().catch((error: unknown) => {
      deps.logger.error({ jobId: job.id, err: error }, '書き出しの前に拡大した一時ファイルを片付けられませんでした')
    })
  }

  const { output, loudnessLufs } = await normalizeOutput(deps, job, result)
  const outputAssetId = await storeOutput(deps, job, project, output)

  // probe / サムネイル / ポスターフレームはこの経路でしか作られない。
  await enqueueIngest(deps, job, outputAssetId)

  await deps.renderJobs.update(job.id, {
    status: 'succeeded',
    progress: 1,
    outputAssetId,
    error: null,
    loudnessLufs,
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
