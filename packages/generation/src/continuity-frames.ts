import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MediaAssetRepository } from '@ixa/db'
import type { MediaAsset, MediaAssetId } from '@ixa/domain'

/**
 * 「前の Shot から続ける」の元のコマ（2026-10-24）。前の Shot が**画面に出す最後のコマ**を番号で切り出し、
 * 参照に渡せる画像の MediaAsset にする。どの番号かは `continuityFrameIndex`（domain）が決める。
 *
 * **api（仕様を組む）と worker（組み直す）が同じ ID を得ること。** 違うとハッシュが食い違い spec_drift で落ちる。
 * そのため置き場のキーを番号から決め、既にあれば切り出さずに中身のハッシュで同じ行を引く。
 */
export type ContinuityFrameSource = {
  frameAt(video: MediaAsset, frameIndex: number): Promise<MediaAssetId>
}

export type ContinuityFrameDeps = {
  readonly mediaAssets: Pick<MediaAssetRepository, 'findByChecksum' | 'create'>
  readonly storage: {
    get(key: string): Promise<Uint8Array>
    put(key: string, body: Uint8Array, options: { readonly contentType: string }): Promise<void>
    exists(key: string): Promise<boolean>
  }
  /** 番号のコマを JPEG に書き出す（`@ixa/media` の `extractFrameByIndex`）。 */
  readonly extractFrame: (inputPath: string, outputPath: string, frameIndex: number) => Promise<void>
  /** 置き場のキー（`@ixa/storage` の `continuityFrameKey`）。キーの規約はここで手書きしない。 */
  readonly frameKey: (workspaceId: string, mediaAssetId: string, frameIndex: number) => string
}

const JPEG = 'image/jpeg'

const sha256 = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex')

export const createContinuityFrameSource = (deps: ContinuityFrameDeps): ContinuityFrameSource => {
  const cut = async (video: MediaAsset, frameIndex: number): Promise<Uint8Array> => {
    const dir = await mkdtemp(join(tmpdir(), 'ixa-continuity-'))
    try {
      const input = join(dir, 'take')
      const output = join(dir, 'frame.jpg')
      await writeFile(input, await deps.storage.get(video.storageKey))
      await deps.extractFrame(input, output, frameIndex)
      return await readFile(output)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  return {
    async frameAt(video, frameIndex) {
      const key = deps.frameKey(video.workspaceId, video.id, frameIndex)
      const body = (await deps.storage.exists(key))
        ? await deps.storage.get(key)
        : await (async () => {
            const cutBody = await cut(video, frameIndex)
            await deps.storage.put(key, cutBody, { contentType: JPEG })
            return cutBody
          })()

      const checksumSha256 = sha256(body)
      const found = await deps.mediaAssets.findByChecksum(checksumSha256)
      if (found !== null) return found.id
      try {
        const created = await deps.mediaAssets.create({
          workspaceId: video.workspaceId,
          projectId: video.projectId,
          kind: 'image',
          storageKey: key,
          mimeType: JPEG,
          bytes: body.byteLength,
          checksumSha256,
          origin: { type: 'derived', sourceAssetId: video.id, operation: `continuity_frame:${frameIndex}` },
          tags: ['continuity_frame'],
        })
        return created.id
      } catch (error) {
        // api と worker が同時に作ると、中身のハッシュの一意制約で片方が断られる。先に作られた行を使う。
        const raced = await deps.mediaAssets.findByChecksum(checksumSha256)
        if (raced !== null) return raced.id
        throw new Error(`繋ぎ目のコマ（${video.id} の ${frameIndex} コマ目）を登録できませんでした`, { cause: error })
      }
    },
  }
}
