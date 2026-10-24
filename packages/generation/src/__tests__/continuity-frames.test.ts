import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { newId, ProjectId as ProjectIdSchema, WorkspaceId as WorkspaceIdSchema } from '@ixa/domain'
import { createContinuityFrameSource } from '../continuity-frames.js'
import { createInMemoryMediaAssetRepository } from '../testing.js'

/**
 * 「前の Shot から続ける」の元のコマを、番号で切り出して MediaAsset にする（2026-10-24）。
 * **api と worker が同じ ID を得ること**が要（違うと仕様のハッシュが食い違い spec_drift で落ちる）。
 */
const workspaceId = newId(WorkspaceIdSchema)
const projectId = newId(ProjectIdSchema)

const setup = () => {
  const files = new Map<string, Uint8Array>([['take.mp4', new Uint8Array([1, 2, 3])]])
  const storage = {
    get: vi.fn((key: string) => Promise.resolve(files.get(key) ?? new Uint8Array())),
    put: vi.fn((key: string, body: Uint8Array) => {
      files.set(key, body)
      return Promise.resolve()
    }),
    exists: vi.fn((key: string) => Promise.resolve(files.has(key))),
  }
  const extractFrame = vi.fn(async (_input: string, output: string, index: number) => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(output, `frame-${index}`)
  })
  const mediaAssets = createInMemoryMediaAssetRepository()
  const source = createContinuityFrameSource({
    mediaAssets,
    storage,
    extractFrame,
    frameKey: (ws, id, index) => `media/${ws}/${id}/frame-${index}.jpg`,
  })
  return { files, storage, extractFrame, mediaAssets, source }
}

const video = async (mediaAssets: ReturnType<typeof createInMemoryMediaAssetRepository>) =>
  mediaAssets.create({
    workspaceId, projectId, kind: 'video', storageKey: 'take.mp4', mimeType: 'video/mp4', bytes: 3,
    checksumSha256: 'b'.repeat(64), origin: { type: 'upload', uploadedBy: 'tester' },
  })

describe('createContinuityFrameSource', () => {
  it('番号のコマを切り出して画像の MediaAsset にする', async () => {
    const { source, mediaAssets, extractFrame, files } = setup()
    const take = await video(mediaAssets)

    const id = await source.frameAt(take, 79)
    const asset = await mediaAssets.findById(id)

    expect(extractFrame).toHaveBeenCalledWith(expect.any(String), expect.any(String), 79)
    expect(asset?.kind).toBe('image')
    expect(asset?.storageKey).toBe(`media/${workspaceId}/${take.id}/frame-79.jpg`)
    expect(asset?.origin).toEqual({ type: 'derived', sourceAssetId: take.id, operation: 'continuity_frame:79' })
    expect(asset?.checksumSha256).toBe(createHash('sha256').update('frame-79').digest('hex'))
    expect(files.has(`media/${workspaceId}/${take.id}/frame-79.jpg`)).toBe(true)
  })

  it('2 回目（worker の組み直し）は切り出さずに同じ ID を返す', async () => {
    const { source, mediaAssets, extractFrame } = setup()
    const take = await video(mediaAssets)

    const first = await source.frameAt(take, 79)
    const second = await source.frameAt(take, 79)

    expect(second).toBe(first)
    expect(extractFrame).toHaveBeenCalledTimes(1)
  })

  it('違う番号は別の MediaAsset になる', async () => {
    const { source, mediaAssets } = setup()
    const take = await video(mediaAssets)
    expect(await source.frameAt(take, 79)).not.toBe(await source.frameAt(take, 89))
  })
})
