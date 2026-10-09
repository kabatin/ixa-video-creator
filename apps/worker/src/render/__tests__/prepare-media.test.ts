import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  MediaAssetId,
  ProjectId,
  ShotId,
  WorkspaceId,
  type MediaAsset,
  type TimelineDocument,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { silentLogger } from '../../generation/__tests__/doubles.js'
import { createMediaPreparer, type MediaPreparerDeps } from '../prepare-media.js'

/**
 * 書き出しの直前の拡大（ADR-0045 段 3）。
 * **拡大が要る素材が無ければ何もしない**——いまの素材はすべてそうなので、今日の書き出しは変わらない。
 */
const FRAME = { width: 1920, height: 1080 }
const NATIVE = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1')
const FULL = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA2')
const UNMEASURED = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA3')
const UPSCALED_BYTES = 'upscaled-by-lanczos'

const asset = (id: MediaAssetId, size: { width: number; height: number } | null): MediaAsset => ({
  id,
  workspaceId: WorkspaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FW0'),
  projectId: ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FP0'),
  kind: 'video',
  storageKey: `media/${id}/original.mp4`,
  mimeType: 'video/mp4',
  bytes: 10,
  checksumSha256: 'a'.repeat(64),
  probe:
    size === null
      ? null
      : { durationSec: 3, width: size.width, height: size.height, fps: 24, hasAudio: false, codec: 'h264' },
  proxyKey: null,
  thumbnailKey: null,
  posterKeys: [],
  lastFrameAssetId: null,
  origin: { type: 'upload', uploadedBy: 'test' },
  tags: [],
  createdAt: new Date(0),
})

const ASSETS = new Map<MediaAssetId, MediaAsset>([
  [NATIVE, asset(NATIVE, { width: 1344, height: 756 })],
  [FULL, asset(FULL, { width: 1920, height: 1080 })],
  [UNMEASURED, asset(UNMEASURED, null)],
])

const documentWith = (ids: readonly MediaAssetId[]): TimelineDocument => ({
  version: 1,
  fps: 24,
  resolution: FRAME,
  durationSec: ids.length * 3,
  video1: ids.map((id, i) => ({
    shotId: ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5FS${String(i)}`),
    startSec: i * 3,
    durationSec: 3,
    mediaUrl: `https://signed.test/${id}`,
    mediaAssetId: id,
    inSec: 0,
  })),
  transitions: [],
  clips: [],
  audio: [],
})

const deps = (overrides: Partial<MediaPreparerDeps> = {}) => {
  const upscaled: string[] = []
  const value: MediaPreparerDeps = {
    mediaAssets: { findById: (id) => Promise.resolve(ASSETS.get(id) ?? null) },
    storage: { get: () => Promise.resolve(new TextEncoder().encode('original')) },
    upscale: async (_input, output) => {
      upscaled.push(output)
      await writeFile(output, UPSCALED_BYTES)
    },
    logger: silentLogger,
    ...overrides,
  }
  return { deps: value, upscaled }
}

describe('createMediaPreparer', () => {
  it('いまの素材（枠と同じ大きさ）だけなら、同じ文書をそのまま返し何も作らない', async () => {
    const { deps: d, upscaled } = deps()
    const doc = documentWith([FULL])

    const prepared = await createMediaPreparer(d)(doc, FRAME)

    expect(prepared.document).toBe(doc)
    expect(prepared.upscaled).toBe(0)
    expect(upscaled).toEqual([])
    await prepared.release()
  })

  it('枠より小さい素材だけ拡大し、その URL を手元の口へ差し替える', async () => {
    const { deps: d, upscaled } = deps()
    const prepared = await createMediaPreparer(d)(documentWith([NATIVE, FULL]), FRAME)

    try {
      expect(prepared.upscaled).toBe(1)
      expect(upscaled).toHaveLength(1)
      const [native, full] = prepared.document.video1
      expect(native?.mediaUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]{36}$/)
      expect(full?.mediaUrl).toBe(`https://signed.test/${FULL}`)

      const response = await fetch(native?.mediaUrl ?? '')
      expect(response.status).toBe(200)
      expect(response.headers.get('content-length')).toBe(String(UPSCALED_BYTES.length))
      expect(await response.text()).toBe(UPSCALED_BYTES)
    } finally {
      await prepared.release()
    }
  })

  it('片付けると口が閉じ、一時ファイルも消える', async () => {
    const { deps: d, upscaled } = deps()
    const prepared = await createMediaPreparer(d)(documentWith([NATIVE]), FRAME)
    const url = prepared.document.video1[0]?.mediaUrl ?? ''
    const dir = dirname(upscaled[0] ?? '')

    await prepared.release()

    expect(existsSync(dir)).toBe(false)
    await expect(fetch(url)).rejects.toThrow()
  })

  it('大きさが測れていない素材は触らない（推測しない）', async () => {
    const { deps: d, upscaled } = deps()
    const doc = documentWith([UNMEASURED])
    const prepared = await createMediaPreparer(d)(doc, FRAME)

    expect(prepared.document).toBe(doc)
    expect(upscaled).toEqual([])
  })

  it('登録していない番号と、外へ出ようとするパスには何も返さない', async () => {
    const { deps: d } = deps()
    const prepared = await createMediaPreparer(d)(documentWith([NATIVE]), FRAME)
    try {
      const origin = new URL(prepared.document.video1[0]?.mediaUrl ?? '').origin
      expect((await fetch(`${origin}/not-registered`)).status).toBe(404)
      expect((await fetch(`${origin}/../../etc/passwd`)).status).toBe(404)
      expect((await fetch(`${origin}/%2e%2e%2fetc%2fpasswd`)).status).toBe(404)
    } finally {
      await prepared.release()
    }
  })

  it('拡大に失敗したら文脈を付けて投げ、一時ファイルを残さない', async () => {
    let seenDir = ''
    const { deps: d } = deps({
      upscale: async (input) => {
        seenDir = dirname(input)
        await readFile(input)
        throw new Error('ffmpeg が落ちた')
      },
    })

    await expect(createMediaPreparer(d)(documentWith([NATIVE]), FRAME)).rejects.toThrow(
      /書き出しの前の拡大に失敗しました: ffmpeg が落ちた/,
    )
    expect(seenDir).not.toBe('')
    expect(existsSync(seenDir)).toBe(false)
  })
})
