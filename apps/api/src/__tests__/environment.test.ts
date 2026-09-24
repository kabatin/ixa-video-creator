import { describe, expect, it } from 'vitest'
import type { EnvironmentStatus } from '@ixa/config'
import { createApp } from '../app.js'
import { baseAppDeps } from './app-deps.js'

/**
 * 環境の状態を返す口（A 案）。
 *
 * **この API は無認証で全インターフェースに待ち受けている**（`TCP *:3001`）。
 * 値を返せば同じ網にいる誰でも課金される鍵を読める。
 * ここが「設定されているか」までしか返さないことを、経路として押さえる。
 */

const SECRET = 'fal-live-SUPERSECRET-0123456789'

const aStatus = (): EnvironmentStatus => ({
  secrets: [
    {
      label: 'fal.ai（映像生成）',
      envName: 'FAL_API_KEY',
      configured: true,
      length: SECRET.length,
      purpose: '実際の映像生成に使う。',
    },
  ],
  settings: [
    {
      label: '絵コンテの下書き',
      envName: 'STORYBOARD_DRAFTER',
      value: 'claude_cli',
      notable: true,
      note: 'Claude を実際に呼ぶ。',
    },
  ],
})

const appWith = (status: () => EnvironmentStatus) =>
  createApp({ ...baseAppDeps(), environment: { status } })

describe('GET /environment', () => {
  it('設定されているかと文字数を返す', async () => {
    const res = await appWith(aStatus).request('/environment')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: EnvironmentStatus }
    expect(body.data.secrets[0]?.configured).toBe(true)
    expect(body.data.secrets[0]?.length).toBe(SECRET.length)
  })

  it('お金に効く設定は値ごと返す（秘密ではない）', async () => {
    const res = await appWith(aStatus).request('/environment')
    const body = (await res.json()) as { data: EnvironmentStatus }
    expect(body.data.settings[0]?.value).toBe('claude_cli')
    expect(body.data.settings[0]?.notable).toBe(true)
  })

  /**
   * **値を足そうとしたら経路で落ちること。** スキーマが `.strict()` なので、
   * うっかり `value` を秘密側に載せても本文には出ない。
   */
  it('秘密に値を混ぜて渡しても、本文に出さない', async () => {
    const leaky = (): EnvironmentStatus =>
      ({
        ...aStatus(),
        secrets: [{ ...aStatus().secrets[0], value: SECRET }],
      }) as unknown as EnvironmentStatus

    const res = await appWith(leaky).request('/environment')
    const text = await res.text()
    expect(text).not.toContain(SECRET)
  })

  it('鍵を設定する口は置かない', async () => {
    const app = appWith(aStatus)
    const put = await app.request('/environment', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ FAL_API_KEY: SECRET }),
    })
    const post = await app.request('/environment', { method: 'POST' })
    expect(put.status).toBe(404)
    expect(post.status).toBe(404)
  })
})
