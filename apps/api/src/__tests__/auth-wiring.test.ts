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

const realApp = () =>
  createApp({
    ...baseAppDeps(),
    auth: createAuth({
      passphrase: PASSPHRASE,
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

describe('createAuth', () => {
  it('合言葉が無ければ組まない（API を起動させない）', () => {
    expect(() =>
      createAuth({ passphrase: null, tokens: createInMemoryAccessTokens(), allowedOrigins: [], logger: createLogger('silent') }),
    ).toThrow(/IXA_PASSPHRASE/)
  })
})
