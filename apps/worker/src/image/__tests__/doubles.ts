import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImageGenerationRequest, ImageJobStatus, ImageProvider } from '@ixa/provider-core'
import { codexCliImageModel } from '@ixa/provider-image'

/** 1 PNG 相当の中身（切り抜きは差し替えるので、本物の画像である必要はない）。 */
export const FAKE_PNG = Buffer.from('89504e470d0a1a0a0000', 'hex')

export type FakeImageProvider = ImageProvider & { readonly requests: ImageGenerationRequest[] }

/** 要求を覚え、`outcome` どおりに終わる偽の画像 Provider。成功なら `outputDir` に PNG を書く。 */
export const fakeImageProvider = (
  outputDir: string,
  outcome: 'succeeded' | { readonly code: string; readonly message: string } = 'succeeded',
): FakeImageProvider => {
  const requests: ImageGenerationRequest[] = []
  const statuses = new Map<string, ImageJobStatus>()
  return {
    id: codexCliImageModel.providerId,
    models: [codexCliImageModel],
    requests,
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
      } else {
        statuses.set(ref, { state: 'failed', error: { ...outcome, retryable: true } })
      }
      return { providerId: codexCliImageModel.providerId, modelId: codexCliImageModel.id, ref, submittedAt: new Date() }
    },
    poll: (handle) => Promise.resolve(statuses.get(handle.ref) ?? { state: 'running', progress: null }),
    cancel: () => Promise.resolve(),
  }
}
