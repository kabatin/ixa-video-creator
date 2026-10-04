import { ProjectId, newId } from '@ixa/domain'
import { afterEach, describe, expect, it } from 'vitest'
import { createProjectDuplicateApi } from '@/lib/project-duplicate-api'
import { createRequester } from '@/lib/requester'

/** 作品を複製する口の契約（制作者 2026-10-04）。ネットワークには出ない。 */

const BASE_URL = 'https://api.test'
const source = newId(ProjectId)
const copied = newId(ProjectId)
const realFetch = globalThis.fetch

const project = {
  id: copied,
  workspaceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  name: '進め！戦子ちゃん！のコピー',
  fps: 24,
  resolution: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  durationSec: null,
  budgetUsd: null,
  styleGuide: '',
  avoid: '',
  styleReferenceAssetIds: [],
  lyrics: '',
  lyricCues: [],
  instrumental: false,
  status: 'planning',
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('duplicateProject', () => {
  it('名前と項目を POST し、新しい作品と知らせを受け取る', async () => {
    const sent: { url: string; method: string | undefined; body: string | null }[] = []
    globalThis.fetch = (input, init) => {
      sent.push({
        url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
        method: init?.method,
        body: typeof init?.body === 'string' ? init.body : null,
      })
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data: { project, notes: ['Shot 1 件の登場人物を外しました'] } }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }

    const result = await createProjectDuplicateApi(createRequester(BASE_URL)).duplicateProject(source, {
      name: '進め！戦子ちゃん！のコピー',
      items: ['music', 'shots'],
    })

    expect(sent[0]).toMatchObject({ url: `${BASE_URL}/projects/${source}/duplicate`, method: 'POST' })
    expect(JSON.parse(sent[0]?.body ?? 'null')).toEqual({ name: '進め！戦子ちゃん！のコピー', items: ['music', 'shots'] })
    expect(result.project.id).toBe(copied)
    expect(result.notes).toEqual(['Shot 1 件の登場人物を外しました'])
  })
})
