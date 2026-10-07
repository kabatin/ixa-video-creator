import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFsStorage, signStorageAccess, type FsStorage } from '@ixa/storage'
import { createApp } from '../app.js'
import { createLogger } from '../logger.js'
import { baseAppDeps } from './app-deps.js'

/**
 * 手元に置いた素材を返す口（ADR-0041）。
 *
 * MinIO が返していた部分応答・署名の検証を自分で持つことになるので、**経路として押さえる。**
 * ここが抜けると、素材が全部読めなくなるか、誰でも読めるようになる。
 */

const SECRET = 's'.repeat(32)
const NOW_MS = 1_800_000_000_000
const KEY = 'media/01ABC/01DEF/original.mp4'
const BODY = new Uint8Array([...Array(1000).keys()].map((i) => i % 256))
const MAX_UPLOAD_BYTES = 16

const temporaryDirs: string[] = []

type Harness = {
  readonly app: ReturnType<typeof createApp>
  readonly storage: FsStorage
}

const makeHarness = async (nowMs = NOW_MS): Promise<Harness> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ixa-files-route-'))
  temporaryDirs.push(dir)
  const storage = createFsStorage({
    root: path.join(dir, 'storage'),
    publicBaseUrl: 'http://127.0.0.1:3001',
    signingSecret: SECRET,
    nowMs: () => nowMs,
  })
  const app = createApp({
    ...baseAppDeps(),
    storage,
    files: {
      storage,
      signingSecret: SECRET,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      nowMs: () => nowMs,
      logger: createLogger('silent'),
    },
  })
  return { app, storage }
}

/** 署名された URL をそのまま叩く（画面や worker が受け取るものと同じ形）。 */
const getSigned = async (
  harness: Harness,
  key = KEY,
  init?: RequestInit,
): Promise<Response> => harness.app.request(await harness.storage.signedGetUrl(key, 3600), init)

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('GET /files/{key}', () => {
  it('署名付き URL で全体が返る', async () => {
    const harness = await makeHarness()
    await harness.storage.put(KEY, BODY, { contentType: 'video/mp4' })

    const response = await getSigned(harness)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('content-length')).toBe('1000')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BODY)
  })

  /** 動画のシーク。Safari は再生の前に頭の数バイトだけを聞く。 */
  it('Range を聞かれたら 206 でその範囲だけ返す', async () => {
    const harness = await makeHarness()
    await harness.storage.put(KEY, BODY, { contentType: 'video/mp4' })

    const response = await getSigned(harness, KEY, { headers: { range: 'bytes=10-19' } })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 10-19/1000')
    expect(response.headers.get('content-length')).toBe('10')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BODY.slice(10, 20))
  })

  it('満たせない範囲は 416 で大きさだけを伝える', async () => {
    const harness = await makeHarness()
    await harness.storage.put(KEY, BODY, { contentType: 'video/mp4' })

    const response = await getSigned(harness, KEY, { headers: { range: 'bytes=5000-6000' } })

    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */1000')
    expect(await response.text()).toBe('')
  })

  it('HEAD は大きさだけ返す（中身は返さない）', async () => {
    const harness = await makeHarness()
    await harness.storage.put(KEY, BODY, { contentType: 'video/mp4' })

    const response = await getSigned(harness, KEY, { method: 'HEAD' })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('1000')
    expect(await response.text()).toBe('')
  })

  it('署名の通った key でも、無い素材は 404', async () => {
    const harness = await makeHarness()

    expect((await getSigned(harness)).status).toBe(404)
  })

  describe('受け取れない URL', () => {
    it('署名が無ければ 403', async () => {
      const harness = await makeHarness()
      await harness.storage.put(KEY, BODY, { contentType: 'video/mp4' })

      const response = await harness.app.request(`/files/${KEY}`)

      expect(response.status).toBe(403)
    })

    it('署名を 1 文字変えたら 403', async () => {
      const harness = await makeHarness()
      await harness.storage.put(KEY, BODY, { contentType: 'video/mp4' })
      const url = new URL(await harness.storage.signedGetUrl(KEY, 3600))
      const signature = url.searchParams.get('sig') ?? ''
      url.searchParams.set('sig', `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`)

      expect((await harness.app.request(url.toString())).status).toBe(403)
    })

    it('期限が切れていたら 403', async () => {
      const harness = await makeHarness()
      await harness.storage.put(KEY, BODY, { contentType: 'video/mp4' })
      const url = await harness.storage.signedGetUrl(KEY, 3600)

      // 同じ素材・同じ鍵のまま、時計だけを 1 日進めた口に同じ URL を出す。
      const later = await makeHarness(NOW_MS + 86_400_000)
      expect((await later.app.request(url)).status).toBe(403)
    })

    it('何が違うかは言わない（期限切れと改竄で同じ文）', async () => {
      const harness = await makeHarness()
      const url = new URL(await harness.storage.signedGetUrl(KEY, 3600))
      url.searchParams.set('sig', '0'.repeat(64))
      const tampered = await harness.app.request(url.toString())

      const later = await makeHarness(NOW_MS + 86_400_000)
      const expired = await later.app.request(await harness.storage.signedGetUrl(KEY, 3600))

      expect(await tampered.text()).toBe(await expired.text())
    })

    /**
     * **2 重の柵。** 署名が通っても、key の形が受け取れないなら実体を触らない。
     * 鍵を知る側（worker や将来の口）が作り間違えても、保管庫の外や想定外のファイルを返さない。
     */
    it('署名が通っても、受け取れない形の key は 403', async () => {
      const harness = await makeHarness()
      const expiresAtSec = Math.floor(NOW_MS / 1000) + 3600
      const key = 'media/01ABC/01DEF/my file.mp4'
      const signature = signStorageAccess({ method: 'GET', key, expiresAtSec }, SECRET)

      const response = await harness.app.request(
        `/files/media/01ABC/01DEF/my%20file.mp4?exp=${String(expiresAtSec)}&sig=${signature}`,
      )

      expect(response.status).toBe(403)
    })

    /**
     * 親へ戻る形は、**URL の層で消える**のでこの口には届かない
     * （`/files/%2E%2E/x` は URL の正規化で `/x` になる。Hono へ渡る前）。
     * 根の外へ出ないことそのものは保管庫側で確かめている（`fs-storage.test.ts`）。
     * ここでは「素材として返ってしまわない」ことだけ押さえる。
     */
    it('親へ戻る形はこの口に届かない', async () => {
      const harness = await makeHarness()
      const expiresAtSec = Math.floor(NOW_MS / 1000) + 3600
      const signature = signStorageAccess({ method: 'GET', key: '../secret.txt', expiresAtSec }, SECRET)

      const response = await harness.app.request(
        `/files/%2E%2E/secret.txt?exp=${String(expiresAtSec)}&sig=${signature}`,
      )

      expect(response.status).toBe(404)
    })

    /** 読む URL を受け取った人が、そのまま上書きできてはいけない。 */
    it('読む署名で PUT はできない', async () => {
      const harness = await makeHarness()
      const url = await harness.storage.signedGetUrl(KEY, 3600)

      const response = await harness.app.request(url, {
        method: 'PUT',
        body: 'overwritten',
        headers: { 'content-type': 'video/mp4' },
      })

      expect(response.status).toBe(403)
      expect(await harness.storage.exists(KEY)).toBe(false)
    })
  })
})

describe('PUT /files/{key}', () => {
  const putSigned = async (
    harness: Harness,
    body: string,
    contentType = 'text/plain',
    signedContentType = contentType,
  ): Promise<Response> =>
    harness.app.request(await harness.storage.signedPutUrl(KEY, signedContentType, 900), {
      method: 'PUT',
      body,
      headers: { 'content-type': contentType },
    })

  it('署名付き URL で取り込める', async () => {
    const harness = await makeHarness()

    const response = await putSigned(harness, 'hello')

    expect(response.status).toBe(200)
    expect(await harness.storage.get(KEY)).toEqual(new TextEncoder().encode('hello'))
  })

  it('署名したときと型が違えば受け取らない', async () => {
    const harness = await makeHarness()

    const response = await putSigned(harness, 'hello', 'text/html', 'text/plain')

    expect(response.status).toBe(403)
    expect(await harness.storage.exists(KEY)).toBe(false)
  })

  /** 受けながら数える。上限を超えたら書きかけを残さない。 */
  it('上限を超えたら 413 で、書きかけを残さない', async () => {
    const harness = await makeHarness()

    const response = await putSigned(harness, 'x'.repeat(MAX_UPLOAD_BYTES + 1))

    expect(response.status).toBe(413)
    expect(await harness.storage.exists(KEY)).toBe(false)
  })

  it('ちょうど上限なら受け取る', async () => {
    const harness = await makeHarness()

    const response = await putSigned(harness, 'x'.repeat(MAX_UPLOAD_BYTES))

    expect(response.status).toBe(200)
    expect((await harness.storage.head(KEY))?.bytes).toBe(MAX_UPLOAD_BYTES)
  })
})

/**
 * 置き場が `s3` のときは、署名を置き場自身が出す。
 * **同じ物に 2 つの入口を作らない**（API 側に残っていると、鍵の管理が二重になる）。
 */
describe('置き場が s3 のとき', () => {
  it('この口は無い', async () => {
    const app = createApp({ ...baseAppDeps() })

    expect((await app.request(`/files/${KEY}?exp=1&sig=x`)).status).toBe(404)
  })
})
