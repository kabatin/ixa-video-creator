import { describe, expect, it } from 'vitest'
import { createStorage, type StorageSettings } from '../create-storage.js'

/**
 * 置き場の選び方（ADR-0041）。**API と worker はこの関数しか呼ばない。**
 * 片方だけ別の作り方をすると「API は読めるのに worker が書けない」になる。
 */

const S3 = {
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  bucket: 'ixa-media',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  forcePathStyle: true,
}

const settings = (overrides: Partial<StorageSettings> = {}): StorageSettings => ({
  driver: 'fs',
  root: '/tmp/ixa-storage-choice',
  publicBaseUrl: 'http://127.0.0.1:3001',
  signingSecret: 's'.repeat(32),
  s3: S3,
  ...overrides,
})

describe('createStorage', () => {
  it('fs なら API の配信ルートを指す URL を出す', async () => {
    const storage = createStorage(settings())

    const url = await storage.signedGetUrl('media/01ABC/01DEF/original.mp4', 60)

    expect(url.startsWith('http://127.0.0.1:3001/files/')).toBe(true)
  })

  it('s3 なら置き場そのものを指す URL を出す', async () => {
    const storage = createStorage(settings({ driver: 's3' }))

    const url = await storage.signedGetUrl('media/01ABC/01DEF/original.mp4', 60)

    expect(url.startsWith('http://127.0.0.1:9000/ixa-media/')).toBe(true)
    expect(url).toContain('X-Amz-Signature=')
  })

  /** 設定の検証（@ixa/config）が先に止めるが、黙って署名なしで動かさないこと。 */
  it('fs で鍵が無ければ作らない', () => {
    expect(() => createStorage(settings({ signingSecret: null }))).toThrow(
      /STORAGE_SIGNING_SECRET/,
    )
  })

  it('s3 で接続先が無ければ作らない', () => {
    expect(() => createStorage(settings({ driver: 's3', s3: null }))).toThrow(/S3_ENDPOINT/)
  })
})
