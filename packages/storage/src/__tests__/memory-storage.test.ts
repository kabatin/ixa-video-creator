import { describe, expect, it } from 'vitest'
import { ObjectNotFoundError } from '../port.js'
import { createMemoryStorage } from '../memory-storage.js'
import { itObeysObjectStorageContract } from './object-storage-contract.js'

describe('createMemoryStorage', () => {
  // fs ドライバと同じ約束を守っていること（ADR-0041 の差し替えはこの上に乗る）。
  itObeysObjectStorageContract(() => Promise.resolve(createMemoryStorage()))

  it('put したオブジェクトを get できる（ラウンドトリップ）', async () => {
    const storage = createMemoryStorage()
    const body = new TextEncoder().encode('hello')

    await storage.put('foo/bar.txt', body, { contentType: 'text/plain' })
    const result = await storage.get('foo/bar.txt')

    expect(result).toEqual(body)
  })

  it('put したオブジェクトを head できる', async () => {
    const storage = createMemoryStorage()
    const body = new TextEncoder().encode('hello world')

    await storage.put('foo/bar.txt', body, { contentType: 'text/plain' })
    const head = await storage.head('foo/bar.txt')

    expect(head).not.toBeNull()
    expect(head?.key).toBe('foo/bar.txt')
    expect(head?.bytes).toBe(body.byteLength)
    expect(head?.contentType).toBe('text/plain')
    expect(head?.lastModified).toBeInstanceOf(Date)
  })

  it('exists は put 前は false、put 後は true を返す', async () => {
    const storage = createMemoryStorage()

    expect(await storage.exists('foo/bar.txt')).toBe(false)
    await storage.put('foo/bar.txt', new Uint8Array([1, 2, 3]), { contentType: 'application/octet-stream' })
    expect(await storage.exists('foo/bar.txt')).toBe(true)
  })

  it('delete したオブジェクトは get できなくなる', async () => {
    const storage = createMemoryStorage()
    await storage.put('foo/bar.txt', new Uint8Array([1]), { contentType: 'application/octet-stream' })

    await storage.delete('foo/bar.txt')

    expect(await storage.exists('foo/bar.txt')).toBe(false)
    await expect(storage.get('foo/bar.txt')).rejects.toThrow(ObjectNotFoundError)
  })

  it('存在しない key の head は null を返す', async () => {
    const storage = createMemoryStorage()
    expect(await storage.head('does/not/exist.txt')).toBeNull()
  })

  it('存在しない key の get は ObjectNotFoundError を throw する', async () => {
    const storage = createMemoryStorage()
    await expect(storage.get('does/not/exist.txt')).rejects.toThrow(ObjectNotFoundError)
  })

  it('signedPutUrl / signedGetUrl は擬似 URL を返す', async () => {
    const storage = createMemoryStorage()

    const putUrl = await storage.signedPutUrl('foo/bar.txt', 'text/plain', 60)
    const getUrl = await storage.signedGetUrl('foo/bar.txt', 120)

    expect(putUrl).toContain('memory://foo/bar.txt')
    expect(putUrl).toContain('expires=60')
    expect(getUrl).toContain('memory://foo/bar.txt')
    expect(getUrl).toContain('expires=120')
  })
})
