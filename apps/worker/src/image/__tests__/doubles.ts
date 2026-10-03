import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImageGenerationRequest, ImageJobStatus, ImageProvider } from '@ixa/provider-core'
import { codexCliImageModel } from '@ixa/provider-image'

/** 1 PNG 相当の中身（切り抜きは差し替えるので、本物の画像である必要はない）。 */
export const FAKE_PNG = Buffer.from('89504e470d0a1a0a0000', 'hex')

export type FakeImageProvider = ImageProvider & {
  readonly requests: ImageGenerationRequest[]
  /** 片付けを頼まれたジョブ参照。 */
  readonly released: string[]
  /** 止めてと頼まれたジョブ参照。 */
  readonly cancelled: string[]
}

/** 要求を覚え、`outcome` どおりに終わる偽の画像 Provider。成功なら `outputDir` に PNG を書く。 */
export const fakeImageProvider = (
  outputDir: string,
  /** `running` は終わらない（止める途中を試すため）。 */
  outcome: 'succeeded' | 'running' | { readonly code: string; readonly message: string } = 'succeeded',
): FakeImageProvider => {
  const requests: ImageGenerationRequest[] = []
  const released: string[] = []
  const cancelled: string[] = []
  const statuses = new Map<string, ImageJobStatus>()
  return {
    id: codexCliImageModel.providerId,
    models: [codexCliImageModel],
    requests,
    released,
    cancelled,
    release: (handle) => {
      released.push(handle.ref)
      return Promise.resolve()
    },
    submit: async (request) => {
      requests.push(request)
      // 実物と同じく、参照はここで手元のパスへ解決される。
      await Promise.all(request.references.map((reference) => request.resolveReference(reference.mediaAssetId)))
      const ref = `job-${String(requests.length)}`
      if (outcome === 'succeeded') {
        const path = join(outputDir, `${ref}.png`)
        await writeFile(path, FAKE_PNG)
        statuses.set(ref, {
          state: 'succeeded',
          outputs: [{ type: 'local', path }],
          seedUsed: null,
          costUsd: 0,
          raw: { kind: 'cli', cliVersion: 'codex-cli 0.154.0', exitCode: 0 },
        })
      } else if (outcome !== 'running') {
        statuses.set(ref, { state: 'failed', error: { ...outcome, retryable: true } })
      }
      return { providerId: codexCliImageModel.providerId, modelId: codexCliImageModel.id, ref, submittedAt: new Date() }
    },
    poll: (handle) => Promise.resolve(statuses.get(handle.ref) ?? { state: 'running', progress: null }),
    cancel: (handle) => {
      cancelled.push(handle.ref)
      return Promise.resolve()
    },
  }
}
