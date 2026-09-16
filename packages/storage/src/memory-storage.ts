import type { ObjectHead, ObjectStorage, PutOptions, StorageKey } from './port.js'
import { ObjectNotFoundError } from './port.js'

type StoredObject = {
  body: Uint8Array
  contentType: string
  lastModified: Date
}

/**
 * テスト用のインメモリ ObjectStorage 実装。
 * 実 API を叩かずにドメイン/アプリ層のロジックを検証するために使う。
 */
export const createMemoryStorage = (): ObjectStorage => {
  const objects = new Map<StorageKey, StoredObject>()

  const put = async (key: StorageKey, body: Uint8Array | Buffer, options: PutOptions): Promise<void> => {
    objects.set(key, {
      body: new Uint8Array(body),
      contentType: options.contentType,
      lastModified: new Date(),
    })
  }

  const get = async (key: StorageKey): Promise<Uint8Array> => {
    const found = objects.get(key)
    if (found === undefined) throw new ObjectNotFoundError(key)
    return found.body
  }

  const head = async (key: StorageKey): Promise<ObjectHead | null> => {
    const found = objects.get(key)
    if (found === undefined) return null
    return {
      key,
      bytes: found.body.byteLength,
      contentType: found.contentType,
      lastModified: found.lastModified,
    }
  }

  const del = async (key: StorageKey): Promise<void> => {
    objects.delete(key)
  }

  const exists = async (key: StorageKey): Promise<boolean> => objects.has(key)

  const signedPutUrl = async (key: StorageKey, contentType: string, expiresInSec: number): Promise<string> =>
    `memory://${key}?op=put&contentType=${encodeURIComponent(contentType)}&expires=${expiresInSec}`

  const signedGetUrl = async (key: StorageKey, expiresInSec: number): Promise<string> =>
    `memory://${key}?op=get&expires=${expiresInSec}`

  return { put, get, head, delete: del, exists, signedPutUrl, signedGetUrl }
}
