import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApiClient, IxaApiError, IxaUnreachableError } from '../api-client.js'
import { parseMcpEnv } from '../env.js'
import { describeError } from '../tool-def.js'
import { BASE, createFakeApi, TOKEN, WORKSPACE } from './fake-api.js'

const clientFor = (fake: ReturnType<typeof createFakeApi>) =>
  createApiClient({ baseUrl: BASE, token: TOKEN, fetch: fake.fetch })

describe('api-client', () => {
  it('Bearer を付け、data を zod で検証して返す', async () => {
    const fake = createFakeApi([{ method: 'GET', path: '/projects', data: [{ id: 'a' }] }])
    const data = await clientFor(fake).get('/projects', z.array(z.object({ id: z.string() })), { workspaceId: WORKSPACE })
    expect(data).toEqual([{ id: 'a' }])
    expect(fake.calls[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(fake.calls[0]?.url).toBe(`${BASE}/projects?workspaceId=${WORKSPACE}`)
  })

  it('JSON 本文を content-type 付きで送る', async () => {
    const fake = createFakeApi([{ method: 'POST', path: '/x', data: {} }])
    await clientFor(fake).post('/x', { a: 1 }, z.object({}))
    expect(fake.calls[0]?.headers['content-type']).toBe('application/json')
    expect(fake.calls[0]?.body).toEqual({ a: 1 })
  })

  it('失敗は API の文・状態コード・項目ごとの文を持つ IxaApiError になる', async () => {
    const fake = createFakeApi([
      {
        method: 'POST',
        path: '/projects',
        status: 422,
        raw: { success: false, error: '入力の検証に失敗しました', fields: { name: ['短すぎます'] } },
      },
    ])
    const error = await clientFor(fake).post('/projects', {}, z.unknown()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(IxaApiError)
    const text = describeError(error)
    expect(text).toContain('422')
    expect(text).toContain('入力の検証に失敗しました')
    expect(text).toContain('name: 短すぎます')
    expect(text).not.toContain(TOKEN)
  })

  it('本文が統一形式でない失敗も状態コードで伝える', async () => {
    const fake = createFakeApi([{ method: 'GET', path: '/x', status: 502, raw: 'bad gateway' }])
    const error = await clientFor(fake).get('/x', z.unknown()).catch((e: unknown) => e)
    expect(describeError(error)).toContain('502')
  })

  it('204 は本文なしで受ける', async () => {
    const fake = createFakeApi([{ method: 'DELETE', path: '/transitions/1', status: 204 }])
    await expect(clientFor(fake).request('DELETE', '/transitions/1', z.unknown())).resolves.toBeUndefined()
  })

  it('応答の形が違えば落とす（黙って通さない）', async () => {
    const fake = createFakeApi([{ method: 'GET', path: '/x', data: { id: 1 } }])
    await expect(clientFor(fake).get('/x', z.object({ id: z.string() }))).rejects.toThrow('応答の形が想定と違います')
  })

  it('届かないときの文に鍵も URL も出さない', async () => {
    const client = createApiClient({
      baseUrl: BASE,
      token: TOKEN,
      fetch: () => Promise.reject(new Error('connect ECONNREFUSED')),
    })
    const error = await client.get('/health', z.unknown()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(IxaUnreachableError)
    expect(describeError(error)).not.toContain(TOKEN)
    const signed = await client.download('http://storage.test/files/a?sig=SIGNATURE').catch((e: unknown) => e)
    expect(describeError(signed)).not.toContain('SIGNATURE')
  })

  it('署名付き URL には鍵を送らない（取り出し・置き場とも）', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: '/files/a', bytes: new Uint8Array([1, 2]) },
      { method: 'PUT', path: '/files/b', status: 200, data: {} },
    ])
    const client = clientFor(fake)
    await client.download('/files/a?sig=1')
    await client.upload(`${BASE}/files/b?sig=2`, new Uint8Array([1]), 'audio/mpeg')
    expect(fake.calls.map((c) => c.headers.authorization)).toEqual([undefined, undefined])
    expect(fake.calls[0]?.url).toBe(`${BASE}/files/a?sig=1`)
  })

  it('取り出しの失敗の文に本文を載せない', async () => {
    const fake = createFakeApi([{ method: 'GET', path: '/files/a', status: 403, raw: { AWSAccessKeyId: 'LEAK' } }])
    const error = await clientFor(fake).download('/files/a').catch((e: unknown) => e)
    expect(describeError(error)).toContain('403')
    expect(describeError(error)).not.toContain('LEAK')
  })
})

describe('parseMcpEnv', () => {
  const valid = { IXA_API_TOKEN: TOKEN, IXA_WORKSPACE_ID: WORKSPACE }

  it('既定値を埋め、末尾の / を落とし、~ を展開する', () => {
    const env = parseMcpEnv({ ...valid, IXA_API_URL: 'http://127.0.0.1:3001/' })
    expect(env.IXA_API_URL).toBe('http://127.0.0.1:3001')
    expect(env.IXA_MCP_OUTPUT_DIR).not.toContain('~')
    expect(env.IXA_MCP_OUTPUT_DIR.endsWith('Movies/ixa-mcp')).toBe(true)
    expect(parseMcpEnv(valid).IXA_API_URL).toBe('http://127.0.0.1:3001')
  })

  it('鍵が無ければ断る', () => {
    expect(() => parseMcpEnv({ IXA_WORKSPACE_ID: WORKSPACE })).toThrow('IXA_API_TOKEN')
    expect(() => parseMcpEnv({ ...valid, IXA_API_TOKEN: '' })).toThrow('IXA_API_TOKEN')
  })

  it('ワークスペースが ULID でなければ断り、文に値を載せない', () => {
    expect(() => parseMcpEnv({ ...valid, IXA_WORKSPACE_ID: 'not-a-ulid' })).toThrow('IXA_WORKSPACE_ID')
    try {
      parseMcpEnv({ ...valid, IXA_WORKSPACE_ID: 'not-a-ulid', IXA_API_URL: 'nope' })
    } catch (error) {
      expect(String(error)).not.toContain(TOKEN)
      expect(String(error)).toContain('IXA_API_URL')
    }
  })

  it('知らないログの段階を断る', () => {
    expect(() => parseMcpEnv({ ...valid, LOG_LEVEL: 'loud' })).toThrow('LOG_LEVEL')
  })

  it('出力先が空文字なら断る', () => {
    expect(() => parseMcpEnv({ ...valid, IXA_MCP_OUTPUT_DIR: '' })).toThrow('IXA_MCP_OUTPUT_DIR')
  })
})
