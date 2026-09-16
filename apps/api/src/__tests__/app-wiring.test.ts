import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { baseAppDeps } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * createApp がルート群を実際に登録しているかの回帰テスト。
 * ルート単体のテストは routes/*.test.ts にあるが、app.ts への配線漏れはそこでは検出できない。
 */
const project = aProject()

const buildApp = () =>
  createApp({ ...baseAppDeps(), projects: createInMemoryProjectRepository([project]) })

describe('createApp のルート配線', () => {
  it('Script のルートが生えている', async () => {
    // Script は最初の版を追記した時点で生まれるため、GET ではなく追記で確かめる
    const res = await buildApp().request(`/projects/${project.id}/script/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '# 第 1 稿', authoredBy: 'human' }),
    })
    expect(res.status).toBe(201)
  })

  it('Sequence のルートが生えている', async () => {
    const res = await buildApp().request(`/projects/${project.id}/sequences`)
    expect(res.status).toBe(200)
  })
})
