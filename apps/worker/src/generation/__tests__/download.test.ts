import { createMemoryStorage } from '@ixa/storage'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_DOWNLOAD_BYTES, DownloadError, downloadToStorage } from '../download.js'
import type { HostResolver } from '../ssrf.js'

/**
 * 実ネットワークには出ない。fetch と DNS 解決を注入して経路だけを検証する。
 */

const PUBLIC_IPS: Record<string, readonly string[]> = {
  'cdn.example.com': ['93.184.216.34'],
  'evil.example.com': ['93.184.216.35'],
  'internal.example.com': ['10.0.0.5'],
  'metadata.example.com': ['169.254.169.254'],
}

const resolveHost: HostResolver = (hostname) => Promise.resolve(PUBLIC_IPS[hostname] ?? [])

const body = (bytes: number): Uint8Array => new Uint8Array(bytes).fill(7)

const targetUrl = (input: Parameters<typeof fetch>[0]): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

const respondWith = (routes: Record<string, () => Response>): typeof fetch =>
  vi.fn((input: Parameters<typeof fetch>[0]) => {
    const url = targetUrl(input)
    const route = routes[url] ?? routes[url.replace(/\/$/, '')]
    if (route === undefined) return Promise.reject(new Error(`未定義のルート: ${url}`))
    return Promise.resolve(route())
  })

const KEY = 'media/WS/ASSET/original.mp4'

describe('downloadToStorage', () => {
  it('取得した本文をストレージへ格納し、sha256 とサイズを返す', async () => {
    const storage = createMemoryStorage()
    const payload = body(1024)

    const result = await downloadToStorage({
      url: 'https://cdn.example.com/out.mp4',
      storage,
      key: KEY,
      resolveHost,
      fetchImpl: respondWith({
        'https://cdn.example.com/out.mp4': () =>
          new Response(payload, { headers: { 'content-type': 'video/mp4' } }),
      }),
    })

    expect(result.bytes).toBe(1024)
    expect(result.contentType).toBe('video/mp4')
    expect(result.checksumSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(await storage.head(KEY)).toMatchObject({ bytes: 1024 })
  })

  it('Content-Length がサイズ上限を超えたら失敗し、ストレージへ書かない', async () => {
    const storage = createMemoryStorage()

    const promise = downloadToStorage({
      url: 'https://cdn.example.com/huge.mp4',
      storage,
      key: KEY,
      maxBytes: 100,
      resolveHost,
      fetchImpl: respondWith({
        'https://cdn.example.com/huge.mp4': () =>
          new Response(body(10), { headers: { 'content-length': '999999' } }),
      }),
    })

    await expect(promise).rejects.toThrow(DownloadError)
    await expect(promise).rejects.toMatchObject({ code: 'too_large' })
    expect(await storage.head(KEY)).toBeNull()
  })

  it('Content-Length が無くても本文が上限を超えたら打ち切る', async () => {
    const storage = createMemoryStorage()

    const promise = downloadToStorage({
      url: 'https://cdn.example.com/stream.mp4',
      storage,
      key: KEY,
      maxBytes: 512,
      resolveHost,
      fetchImpl: respondWith({
        'https://cdn.example.com/stream.mp4': () => new Response(body(4096)),
      }),
    })

    await expect(promise).rejects.toMatchObject({ code: 'too_large' })
    expect(await storage.head(KEY)).toBeNull()
  })

  it('既定のサイズ上限は 2GB', () => {
    expect(DEFAULT_MAX_DOWNLOAD_BYTES).toBe(2 * 1024 * 1024 * 1024)
  })

  it('リダイレクトを追える（公開アドレス同士）', async () => {
    const storage = createMemoryStorage()

    const result = await downloadToStorage({
      url: 'https://cdn.example.com/redirect',
      storage,
      key: KEY,
      resolveHost,
      fetchImpl: respondWith({
        'https://cdn.example.com/redirect': () =>
          new Response(null, { status: 302, headers: { location: 'https://evil.example.com/ok.mp4' } }),
        'https://evil.example.com/ok.mp4': () => new Response(body(8)),
      }),
    })

    expect(result.bytes).toBe(8)
  })
})

describe('SSRF 対策', () => {
  const cases: readonly { readonly name: string; readonly location: string }[] = [
    { name: 'localhost', location: 'http://localhost:9000/secret' },
    { name: 'ループバック IP', location: 'http://127.0.0.1:9000/secret' },
    { name: 'プライベート IP', location: 'http://10.0.0.5/secret' },
    { name: 'クラウドのメタデータ', location: 'http://169.254.169.254/latest/meta-data/' },
    { name: 'IPv6 ループバック', location: 'http://[::1]:9000/secret' },
    { name: '内部 IP へ解決されるホスト名', location: 'http://internal.example.com/secret' },
    { name: 'メタデータへ解決されるホスト名', location: 'http://metadata.example.com/' },
    { name: 'file スキーム', location: 'file:///etc/passwd' },
  ]

  it.each(cases)('リダイレクト先が $name なら拒否する', async ({ location }) => {
    const storage = createMemoryStorage()
    const reached = vi.fn()

    const promise = downloadToStorage({
      url: 'https://cdn.example.com/redirect',
      storage,
      key: KEY,
      resolveHost,
      fetchImpl: respondWith({
        'https://cdn.example.com/redirect': () =>
          new Response(null, { status: 302, headers: { location } }),
        [location]: () => {
          reached()
          return new Response(body(4))
        },
      }),
    })

    await expect(promise).rejects.toMatchObject({ code: 'blocked_address' })
    // 内部ホストへ 1 度もリクエストしていないこと
    expect(reached).not.toHaveBeenCalled()
    expect(await storage.head(KEY)).toBeNull()
  })

  it('最初の URL が内部を指していても拒否する', async () => {
    const promise = downloadToStorage({
      url: 'http://169.254.169.254/latest/meta-data/',
      storage: createMemoryStorage(),
      key: KEY,
      resolveHost,
      fetchImpl: respondWith({}),
    })

    await expect(promise).rejects.toMatchObject({ code: 'blocked_address' })
  })

  it('リダイレクトの回数が上限を超えたら失敗する', async () => {
    const promise = downloadToStorage({
      url: 'https://cdn.example.com/loop',
      storage: createMemoryStorage(),
      key: KEY,
      maxRedirects: 2,
      resolveHost,
      fetchImpl: respondWith({
        'https://cdn.example.com/loop': () =>
          new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/loop' } }),
      }),
    })

    await expect(promise).rejects.toMatchObject({ code: 'too_many_redirects' })
  })
})
