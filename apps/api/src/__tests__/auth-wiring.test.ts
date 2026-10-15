import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { createAuth } from '../auth/create-auth.js'
import { createLogger } from '../logger.js'
import { baseAppDeps } from './app-deps.js'
import { createInMemoryAccessTokens } from './in-memory-access-token-repository.js'

/**
 * 本物の門を `createApp` に入れたとき（`main.ts` と同じ組み方）。
 * **門の部品が正しくても、差し込み忘れれば全部素通りになる。** 組んだ app で確かめる。
 */
const PASSPHRASE = 'correct horse battery staple'

const realApp = (passphrase: string | null = PASSPHRASE, host = '127.0.0.1') =>
  createApp({
    ...baseAppDeps(),
    auth: createAuth({
      passphrase,
      host,
      tokens: createInMemoryAccessTokens(),
      allowedOrigins: ['http://localhost:3000'],
      logger: createLogger('silent'),
    }),
  })

describe('門を差し込んだ app', () => {
  it('作品の一覧は、鍵なしでは 401', async () => {
    const res = await realApp().request('/projects?workspaceId=01ARZ3NDEKTSV4RRFFQ69G5FAV')
    expect(res.status).toBe(401)
  })

  it('起動の確認は鍵なしで通る', async () => {
    expect((await realApp().request('/health')).status).toBe(200)
  })

  it('合言葉で入れば作品の一覧が読める', async () => {
    const app = realApp()
    const login = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: PASSPHRASE }),
    })
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    const res = await app.request('/projects?workspaceId=01ARZ3NDEKTSV4RRFFQ69G5FAV', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
  })
})

const PROJECTS = '/projects?workspaceId=01ARZ3NDEKTSV4RRFFQ69G5FAV'

const loginWith = (app: ReturnType<typeof realApp>, passphrase: string) =>
  app.request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  })

/**
 * 合言葉を決めていないとき（制作者 2026-10-16「初めて触るひとはいきなり認証画面出てきたら拒否反応出しそう」）。
 * **聞かずに入れる。** ただし門は残す（クッキーで来た書き込みの Origin は見続ける）。
 */
describe('合言葉を決めていないとき', () => {
  it('合言葉が要るかを、鍵なしで訊ける', async () => {
    const res = await realApp(null).request('/auth/status')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { passphraseRequired: false } })
  })

  it('合言葉なしで入れ、そのクッキーで作品の一覧が読める', async () => {
    const app = realApp(null)
    const login = await loginWith(app, '')
    expect(login.status).toBe(200)
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    expect((await app.request(PROJECTS, { headers: { Cookie: cookie } })).status).toBe(200)
  })

  it('門は残る（クッキーなしでは 401）', async () => {
    expect((await realApp(null).request(PROJECTS)).status).toBe(401)
  })

  /** 決めているときは、空では入れない（空を「決めていない」と取り違えない）。 */
  it('合言葉を決めていれば、空では入れない', async () => {
    const app = realApp()
    expect((await loginWith(app, '')).status).toBe(401)
    expect(await (await app.request('/auth/status')).json()).toEqual({
      success: true,
      data: { passphraseRequired: true },
    })
  })
})

describe('createAuth', () => {
  /** 合言葉なしで LAN に開くと、LAN の誰でも聞かれずに入れてしまう。 */
  it('この Mac の外に開くなら、合言葉が無ければ組まない（API を起動させない）', () => {
    for (const host of ['0.0.0.0', '::', '192.168.0.5']) {
      expect(() => realApp(null, host)).toThrow(/IXA_PASSPHRASE/)
    }
  })

  it('この Mac の中だけなら、合言葉が無くても組む', () => {
    for (const host of ['127.0.0.1', 'localhost']) {
      expect(() => realApp(null, host)).not.toThrow()
    }
  })

  it('合言葉があれば、外に開いても組む', () => {
    expect(() => realApp(PASSPHRASE, '0.0.0.0')).not.toThrow()
  })
})
