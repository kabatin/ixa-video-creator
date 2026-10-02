import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MediaAssetId as MediaAssetIdSchema,
  newId,
  type ImageGenerationJob,
  type ImageGenerationJobError,
  type MediaAssetId,
  type Project,
} from '@ixa/domain'
import type { ImageJobStatus, ImageModelDescriptor, ImageProvider, ProviderOutput } from '@ixa/provider-core'
import { mediaKey } from '@ixa/storage'
import type { ImageProcessorDeps } from './processor.js'

/**
 * 絵のジョブの共通の手順（ADR-0029）。最初のフレーム（`processor.ts`）とキャラクターシート（`character-sheet.ts`。ADR-0035）が使う:
 * 参照を手元へ落とす・出来上がりを待つ・手元の出力を受け取る・素材として取り込む。
 */

export type ImageAdapter = { readonly provider: ImageProvider; readonly model: ImageModelDescriptor }

/** 1 件のジョブを作るときの材料（ジョブに記された口を選んだ後）。 */
export type JobDeps = ImageProcessorDeps & ImageAdapter

export type ImageJobResult = { readonly state: 'succeeded' | 'failed' | 'skipped' | 'missing' }

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
  (deps: JobDeps, dir: string) =>
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

export const waitForResult = async (
  deps: JobDeps,
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

