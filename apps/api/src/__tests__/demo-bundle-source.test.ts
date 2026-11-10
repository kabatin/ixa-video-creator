import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DemoManifest, type DemoFileRef } from '@ixa/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDirBundleSource, createReleaseBundleSource } from '../demo-project/bundle-source.js'
import { DemoFileError, demoFailureMessage } from '../demo-project/errors.js'
import { makeTempDir, removeDir } from './demo-fixtures.js'

/**
 * 見本のファイルを取る口（ADR-0067）。**確かめてから返す**（大きさ・sha256）。
 * 取りに行く口は、目録より大きい応答を読み切らずに断り、**飛ばされた先の URL を例外に入れない**。
 */

const BYTES = new TextEncoder().encode('見本のファイルの中身')
const SHA = createHash('sha256').update(BYTES).digest('hex')
const ENTRY: DemoFileRef = { file: 'peaks-1.json', sha256: SHA, sizeBytes: BYTES.byteLength }
const SIGNED = 'https://objects.githubusercontent.com/x?X-Amz-Signature=secret&X-Amz-Credential=key'

const manifest = DemoManifest.parse({
  formatVersion: 1,
  demoKey: 'ixa-demo-v1',
  title: '見本',
  baseUrl: 'https://github.com/kabatin/ixa-video-creator/releases/download/demo-v1/',
  media: [],
  files: [{ key: 'music/p/t/peaks.json', ...ENTRY }],
  source: {},
})

const BASE = 'https://github.com/kabatin/ixa-video-creator/releases/download/demo-v1/'
const FIRST = `${BASE}peaks-1.json`
const STORE = 'https://objects.githubusercontent.com/github-production-release-asset/1?X-Amz-Signature=secret&X-Amz-Credential=key'

/** 呼ばれた URL ごとに答える偽の fetch。呼ばれた URL を控える（断った先に送っていないことを見る）。 */
const routedFetch = (routes: Readonly<Record<string, () => Response>>) => {
  const calls: string[] = []
  const impl: typeof fetch = (input) => {
    const url = input instanceof Request ? input.url : input.toString()
    calls.push(url)
    const route = routes[url]
    return route === undefined ? Promise.reject(new TypeError(`fetch failed ${url}`)) : Promise.resolve(route())
  }
  return { calls, impl }
}

const redirectTo = (location: string) => () => new Response(null, { status: 302, headers: { location } })
const bytes = (body: Uint8Array | null, init: ResponseInit = {}) => () => new Response(body, init)

/** 1 歩で取れる（GitHub がそのまま返す）偽の fetch。 */
const fakeFetch = (body: Uint8Array | null, init: ResponseInit = {}) => routedFetch({ [FIRST]: bytes(body, init) })

const failureOf = async (promise: Promise<unknown>): Promise<DemoFileError> => {
  const error: unknown = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(DemoFileError)
  return error as DemoFileError
}

describe('リリースから取る口', () => {
  const source = (impl: typeof fetch) => createReleaseBundleSource({ manifestPath: '/nonexistent/manifest.json', fetch: impl })

  it('目録の頭とファイル名をつないで取りに行き、許した置き場への飛ばしをたどり、確かめた中身を返す', async () => {
    const fake = routedFetch({ [FIRST]: redirectTo(STORE), [STORE]: bytes(BYTES) })
    await expect(source(fake.impl).fetchFile(manifest, ENTRY)).resolves.toEqual(Buffer.from(BYTES))
    expect(fake.calls).toEqual([FIRST, STORE])
  })

  it.each([
    ['https から http へ', 'http://objects.githubusercontent.com/x'],
    ['許していないホストへ', 'https://evil.example.com/x'],
    ['手元の・私用のアドレスへ', 'https://10.0.0.1/x'],
    ['利用者名付きの先へ', 'https://user:pw@objects.githubusercontent.com/x'],
  ])('%s飛ばされたら、その先には送らずに断る（URL は言わない）', async (_label, target) => {
    const fake = routedFetch({ [FIRST]: redirectTo(target), [target]: bytes(BYTES) })
    const error = await failureOf(source(fake.impl).fetchFile(manifest, ENTRY))
    expect(error.reason).toBe('network')
    expect(fake.calls).toEqual([FIRST])
    expect(error.message).not.toMatch(/https?:/)
  })

  it('飛ばされるのは 5 回まで（6 回目の先には送らない）', async () => {
    const hop = (i: number) => `${BASE}hop-${String(i)}`
    const chain: readonly (readonly [string, () => Response])[] = [
      [FIRST, redirectTo(hop(1))],
      ...[1, 2, 3, 4, 5].map((i) => [hop(i), redirectTo(hop(i + 1))] as const),
    ]
    const routes: Record<string, () => Response> = Object.fromEntries(chain)
    const fake = routedFetch({ ...routes, [hop(6)]: bytes(BYTES) })
    const error = await failureOf(source(fake.impl).fetchFile(manifest, ENTRY))
    expect(error.message).toContain('飛ばされる回数が多すぎます')
    expect(fake.calls).toEqual([FIRST, hop(1), hop(2), hop(3), hop(4), hop(5)])
  })

  it('読んでいる途中で切れたら、取りに行けなかったと言う（502 の文。ファイル名だけ）', async () => {
    const breaking = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull: (controller) => {
            controller.enqueue(BYTES.slice(0, 4))
            controller.error(new TypeError(`terminated ${STORE}`))
          },
        }),
      )
    const error = await failureOf(source(routedFetch({ [FIRST]: breaking }).impl).fetchFile(manifest, ENTRY))
    expect(error.reason).toBe('network')
    expect(error.message).toContain('peaks-1.json')
    expect(error.message).not.toContain('X-Amz')
    expect(demoFailureMessage(error)).toBe('見本のファイルを取りに行けませんでした。インターネットにつながっているか確かめて、もう一度試してください。')
  })

  it('目録が無ければ見本は無い', async () => {
    await expect(source(fakeFetch(BYTES).impl).manifest()).resolves.toBeNull()
  })

  it('sha256 が合わなければ壊れていたとして断り、URL を言わない', async () => {
    const tampered = new Uint8Array(BYTES.byteLength).fill(65)
    const error = await failureOf(source(fakeFetch(tampered).impl).fetchFile(manifest, ENTRY))
    expect(error.reason).toBe('broken')
    expect(error.message).toContain('peaks-1.json')
    expect(error.message).not.toContain('https://')
  })

  it('目録より大きい応答は、大きさの申告でも、読んでいる途中でも断る', async () => {
    const big = new Uint8Array(BYTES.byteLength + 1)
    // 大きさの申告で断るときは、本文を 1 回も読まない（読んでから上限で断る道と見分ける）。
    let pulls = 0
    const unread = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull: (controller) => {
            pulls += 1
            controller.enqueue(big)
            controller.close()
          },
        }, { highWaterMark: 0 }),
        { headers: { 'content-length': String(big.byteLength) } },
      )
    const declared = await failureOf(source(routedFetch({ [FIRST]: unread }).impl).fetchFile(manifest, ENTRY))
    expect(declared.reason).toBe('broken')
    expect(pulls).toBe(0)
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(big)
        controller.close()
      },
    })
    const streamed = await failureOf(source(routedFetch({ [FIRST]: () => new Response(stream, { status: 200 }) }).impl).fetchFile(manifest, ENTRY))
    expect(streamed.message).toContain('目録より大きい応答')
  })

  it('つながらない・断られたときは、取りに行けなかったと言う（URL も番号も画面の文に入れない）', async () => {
    const offline: typeof fetch = () => Promise.reject(new TypeError(`fetch failed ${SIGNED}`))
    const error = await failureOf(source(offline).fetchFile(manifest, ENTRY))
    expect(error.reason).toBe('network')
    expect(error.message).not.toContain('X-Amz')
    expect(error.cause).toBeUndefined()
    const message = demoFailureMessage(error)
    expect(message).toBe('見本のファイルを取りに行けませんでした。インターネットにつながっているか確かめて、もう一度試してください。')

    const notFound = await failureOf(source(fakeFetch(null, { status: 404 }).impl).fetchFile(manifest, ENTRY))
    expect(notFound.reason).toBe('network')
    expect(demoFailureMessage(notFound)).not.toMatch(/404|https?:/)
  })

})

describe('この機械のフォルダから読む口（DEMO_DIR）', () => {
  let dir: string
  beforeAll(async () => {
    dir = await makeTempDir()
  })
  afterAll(async () => {
    await removeDir(dir)
  })

  it('目録とファイルを読み、確かめる', async () => {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest))
    await writeFile(join(dir, ENTRY.file), BYTES)
    const source = createDirBundleSource(dir)
    expect((await source.manifest())?.demoKey).toBe('ixa-demo-v1')
    await expect(source.fetchFile(manifest, ENTRY)).resolves.toEqual(Buffer.from(BYTES))
  })

  it('無いファイルは足りないと言い、大きいファイルは読まずに断る', async () => {
    const source = createDirBundleSource(dir)
    expect((await failureOf(source.fetchFile(manifest, { ...ENTRY, file: 'none.json' }))).reason).toBe('missing')
    await writeFile(join(dir, 'big.json'), new Uint8Array(BYTES.byteLength + 10))
    expect((await failureOf(source.fetchFile(manifest, { ...ENTRY, file: 'big.json' }))).reason).toBe('broken')
  })
})
