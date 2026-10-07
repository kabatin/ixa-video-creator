import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyStorageAccess } from '../file-signature.js'
import { createFsStorage, STORAGE_FILE_ROUTE_PREFIX, type FsStorage } from '../fs-storage.js'
import { ObjectNotFoundError } from '../port.js'
import { InvalidStorageKeyError } from '../storage-path.js'
import { itObeysObjectStorageContract } from './object-storage-contract.js'

const SECRET = 's'.repeat(32)
const BASE_URL = 'http://127.0.0.1:3001'
const KEY = 'media/01ABC/01DEF/original.mp4'
const NOW_MS = 1_800_000_000_000

const temporaryDirs: string[] = []

const makeRoot = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ixa-fs-storage-'))
  temporaryDirs.push(dir)
  // mkdtemp の下にもう 1 段掘る。**まだ無いフォルダを根に渡したときも動くこと**を同時に確かめる。
  return path.join(dir, 'storage')
}

const makeStorage = async (nowMs = NOW_MS): Promise<FsStorage> =>
  createFsStorage({
    root: await makeRoot(),
    publicBaseUrl: BASE_URL,
    signingSecret: SECRET,
    nowMs: () => nowMs,
  })

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('createFsStorage', () => {
  itObeysObjectStorageContract(() => makeStorage())

  it('無かったフォルダを掘ってから置く', async () => {
    const root = await makeRoot()
    const storage = createFsStorage({ root, publicBaseUrl: BASE_URL, signingSecret: SECRET })

    await storage.put(KEY, new Uint8Array([1, 2, 3]), { contentType: 'video/mp4' })

    expect(await fs.readFile(path.join(root, KEY))).toEqual(Buffer.from([1, 2, 3]))
  })

  it('Finder から見える形で置く（付き添いのファイルを並べない）', async () => {
    const root = await makeRoot()
    const storage = createFsStorage({ root, publicBaseUrl: BASE_URL, signingSecret: SECRET })

    await storage.put(KEY, new Uint8Array([1]), { contentType: 'video/mp4' })

    const entries = await fs.readdir(path.join(root, 'media/01ABC/01DEF'))
    expect(entries).toEqual(['original.mp4'])
  })

  it('書きかけ（.part）を残さない', async () => {
    const root = await makeRoot()
    const storage = createFsStorage({ root, publicBaseUrl: BASE_URL, signingSecret: SECRET })

    await storage.put(KEY, new Uint8Array([1]), { contentType: 'video/mp4' })
    await storage.put(KEY, new Uint8Array([2]), { contentType: 'video/mp4' })

    const entries = await fs.readdir(path.join(root, 'media/01ABC/01DEF'))
    expect(entries.filter((name) => name.endsWith('.part'))).toEqual([])
  })

  it('Content-Type は拡張子から決める', async () => {
    const storage = await makeStorage()

    await storage.put('media/01ABC/01DEF/thumb.jpg', new Uint8Array([1]), {
      contentType: 'application/octet-stream',
    })

    expect((await storage.head('media/01ABC/01DEF/thumb.jpg'))?.contentType).toBe('image/jpeg')
  })

  it('フォルダは head で「無い」と同じ扱い', async () => {
    const storage = await makeStorage()
    await storage.put(KEY, new Uint8Array([1]), { contentType: 'video/mp4' })

    expect(await storage.head('media/01ABC/01DEF')).toBeNull()
  })
})

describe('createFsStorage（根の外へ出ようとする key）', () => {
  it.each([
    { name: '親へ戻る', key: '../secret.mp4' },
    { name: '途中で親へ戻る', key: 'media/../../secret.mp4' },
    { name: '絶対パス', key: '/etc/passwd' },
    { name: '隠しファイル', key: 'media/.ssh' },
  ])('$name は put / get / localPath / 署名のすべてで断る（$key）', async ({ key }) => {
    const storage = await makeStorage()

    await expect(storage.put(key, new Uint8Array([1]), { contentType: 'text/plain' })).rejects.toThrow(
      InvalidStorageKeyError,
    )
    await expect(storage.get(key)).rejects.toThrow(InvalidStorageKeyError)
    await expect(storage.localPath(key)).rejects.toThrow(InvalidStorageKeyError)
    await expect(storage.signedGetUrl(key, 60)).rejects.toThrow(InvalidStorageKeyError)
  })

  /**
   * 形の検査だけでは通ってしまう抜け道。**根の中に外へ向かうリンクを置いて確かめる。**
   * 置けるのはこの機械を触れる人だけだが、置かれていたら配信ルートが何でも返す口になる。
   */
  it('根の中のリンクが外を指していたら読まない', async () => {
    const root = await makeRoot()
    const outside = await makeRoot()
    await fs.mkdir(path.join(outside, 'elsewhere'), { recursive: true })
    await fs.writeFile(path.join(outside, 'elsewhere', 'secret.txt'), 'top secret')
    await fs.mkdir(root, { recursive: true })
    await fs.symlink(path.join(outside, 'elsewhere'), path.join(root, 'media'))

    const storage = createFsStorage({ root, publicBaseUrl: BASE_URL, signingSecret: SECRET })

    await expect(storage.get('media/secret.txt')).rejects.toThrow(InvalidStorageKeyError)
    await expect(storage.localPath('media/secret.txt')).rejects.toThrow(InvalidStorageKeyError)
    await expect(
      storage.put('media/new.txt', new Uint8Array([1]), { contentType: 'text/plain' }),
    ).rejects.toThrow(InvalidStorageKeyError)
    // 書こうとしたものが外へ出ていないこと。
    await expect(fs.readdir(path.join(outside, 'elsewhere'))).resolves.toEqual(['secret.txt'])
  })
})

describe('createFsStorage.localPath', () => {
  it('実体の場所を返す', async () => {
    const root = await makeRoot()
    const storage = createFsStorage({ root, publicBaseUrl: BASE_URL, signingSecret: SECRET })
    await storage.put(KEY, new Uint8Array([1]), { contentType: 'video/mp4' })

    expect(await storage.localPath(KEY)).toBe(path.join(await fs.realpath(root), KEY))
  })

  it('無ければ ObjectNotFoundError', async () => {
    const storage = await makeStorage()

    await expect(storage.localPath(KEY)).rejects.toThrow(ObjectNotFoundError)
  })

  it('フォルダなら ObjectNotFoundError', async () => {
    const storage = await makeStorage()
    await storage.put(KEY, new Uint8Array([1]), { contentType: 'video/mp4' })

    await expect(storage.localPath('media/01ABC/01DEF')).rejects.toThrow(ObjectNotFoundError)
  })
})

describe('createFsStorage の署名付き URL', () => {
  it('配信ルートの下を指し、署名が通る', async () => {
    const storage = await makeStorage()

    const url = new URL(await storage.signedGetUrl(KEY, 3600))

    expect(url.origin).toBe(BASE_URL)
    expect(url.pathname).toBe(`${STORAGE_FILE_ROUTE_PREFIX}/${KEY}`)
    const check = verifyStorageAccess(
      {
        method: 'GET',
        key: KEY,
        expiresAtSec: Number(url.searchParams.get('exp')),
        signature: url.searchParams.get('sig') ?? '',
        nowMs: NOW_MS,
      },
      SECRET,
    )
    expect(check).toEqual({ ok: true })
  })

  /** 2026-10-02 の件。頼むたびに URL が変わると、プレビューが毎回読み直す。 */
  it('同じ窓の中では同じ URL を返す', async () => {
    const root = await makeRoot()
    const at = (nowMs: number): FsStorage =>
      createFsStorage({ root, publicBaseUrl: BASE_URL, signingSecret: SECRET, nowMs: () => nowMs })

    const first = await at(NOW_MS).signedGetUrl(KEY, 3600)
    const soon = await at(NOW_MS + 60_000).signedGetUrl(KEY, 3600)
    const later = await at(NOW_MS + 3_600_000).signedGetUrl(KEY, 3600)

    expect(soon).toBe(first)
    expect(later).not.toBe(first)
  })

  it('頼んだ秒数より早くは切れない', async () => {
    const storage = await makeStorage()

    const url = new URL(await storage.signedGetUrl(KEY, 3600))

    expect(Number(url.searchParams.get('exp'))).toBeGreaterThanOrEqual(NOW_MS / 1000 + 3600)
  })

  /** 読む URL を受け取った人が、そのまま上書きできてはいけない。 */
  it('読む署名では書けない', async () => {
    const storage = await makeStorage()

    const url = new URL(await storage.signedGetUrl(KEY, 3600))
    const check = verifyStorageAccess(
      {
        method: 'PUT',
        key: KEY,
        expiresAtSec: Number(url.searchParams.get('exp')),
        contentType: 'video/mp4',
        signature: url.searchParams.get('sig') ?? '',
        nowMs: NOW_MS,
      },
      SECRET,
    )

    expect(check).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('書く URL は型を載せる', async () => {
    const storage = await makeStorage()

    const url = new URL(await storage.signedPutUrl(KEY, 'video/mp4', 900))

    expect(url.searchParams.get('ct')).toBe('video/mp4')
    const check = verifyStorageAccess(
      {
        method: 'PUT',
        key: KEY,
        expiresAtSec: Number(url.searchParams.get('exp')),
        contentType: 'video/mp4',
        signature: url.searchParams.get('sig') ?? '',
        nowMs: NOW_MS,
      },
      SECRET,
    )
    expect(check).toEqual({ ok: true })
  })

  it('署名の鍵が短ければ URL を出さない', async () => {
    const storage = createFsStorage({
      root: await makeRoot(),
      publicBaseUrl: BASE_URL,
      signingSecret: 'short',
    })

    await expect(storage.signedGetUrl(KEY, 60)).rejects.toThrow('短すぎます')
  })
})
