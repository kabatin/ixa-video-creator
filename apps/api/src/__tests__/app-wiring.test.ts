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

  it('楽曲のルートが生えている', async () => {
    const res = await buildApp().request(`/projects/${project.id}/music-tracks`)
    expect(res.status).toBe(200)
  })

  it('Transition のルートが生えている', async () => {
    const res = await buildApp().request(`/projects/${project.id}/transitions`)
    expect(res.status).toBe(200)
  })

  it('クリップのルートが生えている', async () => {
    const res = await buildApp().request(`/projects/${project.id}/clips`)
    expect(res.status).toBe(200)
  })

  it('タイムラインの検証結果のルートが生えている', async () => {
    // 画面が同じ規則を持たないよう、検証はここからしか取れない。
    const res = await buildApp().request(`/projects/${project.id}/timeline/issues`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true })
  })

  it('動画を Take に取り込むルートが生えている（ADR-0026）', async () => {
    // 未知のパスも封筒付きの 404 になるので、404 では配線を見分けられない。
    // 本文の検証（422 と mediaAssetId の指摘）はルートが生えていないと返らない。
    const res = await buildApp().request('/shots/01ARZ3NDEKTSV4RRFFQ69G5FAV/takes/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(422)
    const body = (await res.json()) as { success: boolean; fields?: Record<string, unknown> }
    expect(body.success).toBe(false)
    expect(Object.keys(body.fields ?? {})).toContain('mediaAssetId')
  })

  it('レビューのルートが生えている', async () => {
    // Take が無いので 404。配線されていなければ Hono の 404 と区別が付かないため、
    // 本文が API の封筒（success: false）であることまで見る。
    const res = await buildApp().request('/takes/01ARZ3NDEKTSV4RRFFQ69G5FAV/reviews')

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ success: false })
  })
})
