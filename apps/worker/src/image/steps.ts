import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MediaAssetId as MediaAssetIdSchema,
  appendRetryDelta,
  newId,
  type ImageGenerationJob,
  type ImageGenerationJobError,
  type ImageGenerationJobId,
  type MediaAssetId,
  type Project,
} from '@ixa/domain'
import { ProviderError, type ImageJobStatus, type ImageModelDescriptor, type ImageProvider, type ProviderOutput } from '@ixa/provider-core'
import { mediaKey } from '@ixa/storage'
import { publishImageJobStatus } from './events.js'
import type { ImageProcessorDeps } from './processor.js'

/**
 * 絵のジョブの共通の手順（ADR-0029）。最初のフレーム（`processor.ts`）とキャラクターシート（`character-sheet.ts`。ADR-0035）が使う:
 * 参照を手元へ落とす・出来上がりを待つ・手元の出力を受け取る・素材として取り込む。
 */

export type ImageAdapter = { readonly provider: ImageProvider; readonly model: ImageModelDescriptor }

/** 1 件のジョブを作るときの材料（ジョブに記された口を選んだ後）。 */
export type JobDeps = ImageProcessorDeps & ImageAdapter

/** `waiting` は手元の GPU の順番待ちで積み直したとき（ADR-0047）。 */
export type ImageJobResult = { readonly state: 'succeeded' | 'failed' | 'skipped' | 'missing' | 'waiting' }

/** Provider の時間切れ（5 分）より長く待たない。ここを越えるのは Provider 側の異常。 */
const MAX_WAIT_MS = 10 * 60 * 1000
const DEFAULT_POLL_INTERVAL_MS = 2_000

export class ImageJobFailure extends Error {
  constructor(readonly failure: ImageGenerationJobError, readonly record: Record<string, unknown> | null = null) {
    super(failure.message)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 参照を手元のファイルへ落とす（Codex CLI には手元のファイルしか渡せない。署名付き URL も作らない）。 */
export const localReferenceResolver =
  (deps: Pick<JobDeps, 'mediaAssets' | 'storage'>, dir: string) =>
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

/**
 * 人が止めたジョブ（制作者 2026-10-04「画像生成も停められるようにしよう」）。失敗ではないので理由を残さず手を引く。
 * 止めた行はリポジトリが上書きさせないので、ここで投げて先へ進めない（最初のフレームを差し替えない）。
 */
export class ImageJobCancelled extends Error {
  constructor(readonly imageJobId: ImageGenerationJobId) {
    super(`絵のジョブ ${imageJobId} は止められました`)
  }
}

/** 止められていたら投げる。作り終えた絵を取り込む前・差し替える前に見る。 */
export const throwIfCancelled = async (deps: JobDeps, imageJobId: ImageGenerationJobId): Promise<void> => {
  const current = await deps.imageJobs.findById(imageJobId)
  if (current?.status === 'cancelled') throw new ImageJobCancelled(imageJobId)
}

/** 問い合わせが続けてこの回数だけ通信で失敗したら諦める（サーバの再起動 1 回で絵を捨てない）。 */
const MAX_CONSECUTIVE_POLL_FAILURES = 3

/** 生成先へ止めてと頼む。頼めなくてもログに残して進む（呼ぶ側はもう結果を使わない）。 */
const stopRemote = async (deps: JobDeps, handle: Handle, imageJobId: ImageGenerationJobId): Promise<void> => {
  await deps.provider.cancel(handle).catch((error: unknown) => {
    deps.logger.warn({ imageJobId, err: error }, '生成先へ止めてと頼めませんでした')
  })
}

/**
 * 出来上がりを待つ。**待っている間に止められたら、生成先へ止めてと頼んで手を引く。**
 * 頼めなくても止めたことは確定している（届いた絵は使わない）ので、ログに残して進む。
 *
 * **諦めるとき（時間切れ・問い合わせが続けて失敗）も生成先を止める。** 止めずに手を離すと、
 * 手元の GPU の順番を返したあとで向こうの生成が走り出し、次の動画と同時に GPU を使う（ADR-0047）。
 * 一度だけの通信の失敗（サーバの再起動中など）では諦めない。
 */
export const waitForResult = async (
  deps: JobDeps,
  handle: Handle,
  imageJobId: ImageGenerationJobId,
): Promise<Extract<ImageJobStatus, { state: 'succeeded' }>> => {
  const deadline = Date.now() + MAX_WAIT_MS
  let failures = 0
  for (;;) {
    const status = await deps.provider.poll(handle).catch(async (error: unknown) => {
      failures += 1
      if (!(error instanceof ProviderError) || !error.retryable || failures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        await stopRemote(deps, handle, imageJobId)
        throw error
      }
      deps.logger.warn({ imageJobId, err: error, failures }, '出来上がりの問い合わせに失敗しました。少し待って聞き直します')
      return null
    })
    if (status !== null) failures = 0
    if (status?.state === 'succeeded') return status
    if (status?.state === 'failed') throw new ImageJobFailure(status.error)
    const current = await deps.imageJobs.findById(imageJobId)
    if (current?.status === 'cancelled') {
      await stopRemote(deps, handle, imageJobId)
      throw new ImageJobCancelled(imageJobId)
    }
    if (Date.now() > deadline) {
      await stopRemote(deps, handle, imageJobId)
      throw new ImageJobFailure({ code: 'timeout', message: '絵が 10 分で仕上がりませんでした。', retryable: true })
    }
    await sleep(deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
  }
}

/**
 * 手元にできた絵のパス。今の Provider（Codex・スタブ）はどちらも手元に置く。
 * URL で返す Provider を繋ぐときは、SSRF の歯止めがある `downloadToStorage` を通すこと（素の fetch をしない）。
 */
export const localPathOf = (output: ProviderOutput): string => {
  if (output.type === 'local') return output.path
  throw new ImageJobFailure({ code: 'unsupported_output', message: '作った絵を受け取れませんでした（手元に置かれていません）。', retryable: false })
}

/** 切り抜いた PNG を素材として保存する。出どころはこのジョブ。 */
export const ingest = async (deps: JobDeps, project: Project, job: ImageGenerationJob, path: string): Promise<MediaAssetId> => {
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


/**
 * やり直しのジョブなら、前の絵のチェックが出した直し方を指示に足す（ADR-0055）。1 枚目・直し方が無ければ元のまま。
 */
export const withRetryDelta = async (deps: JobDeps, job: ImageGenerationJob, prompt: string): Promise<string> => {
  if (job.retryOfJobId === null) return prompt
  const previous = await deps.imageChecks.findByJobId(job.retryOfJobId)
  return appendRetryDelta(prompt, previous?.promptDelta ?? null)
}

/**
 * 絵ができた。**まだ何にも当てない**（ADR-0055）。チェック中にし、サムネイルを頼み、チェックの手順を積む。
 * 当てるのはチェックの手順（`check-step.ts`）が、つながりの最後に 1 回だけ。
 * チェックの手順を積めなければ、当てずに終える（チェック中のまま固めない）。
 */
export const finishDrawing = async (
  deps: JobDeps,
  job: ImageGenerationJob,
  mediaAssetId: MediaAssetId,
  raw: Record<string, unknown>,
  /** Provider へ渡した指示の本文（Codex は包む前）。`raw` には入れない約束なので別に渡す。 */
  sentPrompt: string,
): Promise<void> => {
  const checking = await deps.imageJobs.markChecking(job.id, mediaAssetId, raw, sentPrompt)
  if (checking.status === 'cancelled') throw new ImageJobCancelled(job.id)
  await deps.mediaQueue.enqueue(mediaAssetId)
  await publishImageJobStatus(deps, checking)
  try {
    await deps.queue.check(job.id)
  } catch (error) {
    // チェック中のまま固まると、その Shot で二度と頼めない。当てずに終え、履歴から選べるようにする。
    deps.logger.error({ imageJobId: job.id, err: error }, 'チェックの手順を積めませんでした。当てずに終えます')
    await publishImageJobStatus(deps, await deps.imageJobs.finishChecking(job.id))
  }
}
