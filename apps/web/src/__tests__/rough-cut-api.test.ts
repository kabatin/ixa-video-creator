import { ProjectId, ShotId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_ID, SHOT_ID } from '@/__tests__/fixtures'
import { createRequester } from '@/lib/requester'
import { createRoughCutApi } from '@/lib/rough-cut-api'

/**
 * 粗編集の 2 口（P63-3）。検証したいのは 3 点。
 *
 * 1. `plan` が **POST で、本文を持たない**こと（計算するだけ）
 * 2. `apply` が **受け取った案をそのまま本文に載せる**こと
 * 3. **理由の無い案を通さない**こと。理由が落ちると採否の判断材料が消える
 */

const BASE_URL = 'http://127.0.0.1:3001'
const projectId = ProjectId.parse(PROJECT_ID)
const shotId = ShotId.parse(SHOT_ID)

const MOVE = {
  kind: 'move' as const,
  shotId,
  fromSec: 4.3,
  toSec: 4.5,
  reason: '隙間を閉じる',
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const api = () => createRoughCutApi(createRequester(BASE_URL))

const lastInit = (): RequestInit => fetchMock.mock.calls[0]?.[1] ?? {}

describe('粗編集の案を作る', () => {
  it('POST で叩き、本文を送らない', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { changes: [MOVE], unresolved: [] } }),
    )

    const plan = await api().planRoughCut(projectId)

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${BASE_URL}/projects/${projectId}/timeline/rough-cut/plan`,
    )
    expect(lastInit().method).toBe('POST')
    expect(lastInit().body).toBeUndefined()
    expect(plan.changes).toHaveLength(1)
  })

  it('決められなかったものも受け取る', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { changes: [], unresolved: [{ shotId, reason: 'Take が無い' }] },
      }),
    )

    const plan = await api().planRoughCut(projectId)
    expect(plan.unresolved[0]?.reason).toBe('Take が無い')
  })

  it('**理由の無い案は通さない**', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { changes: [{ ...MOVE, reason: '' }], unresolved: [] },
      }),
    )

    await expect(api().planRoughCut(projectId)).rejects.toThrow()
  })
})

describe('粗編集の案を適用する', () => {
  it('受け取った案をそのまま本文に載せる', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { applied: [MOVE], skipped: [] } }),
    )

    const result = await api().applyRoughCut(projectId, [MOVE])

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${BASE_URL}/projects/${projectId}/timeline/rough-cut/apply`,
    )
    expect(lastInit().method).toBe('POST')
    const body = lastInit().body
    expect(typeof body).toBe('string')
    expect(JSON.parse(body as string)).toEqual({ changes: [MOVE] })
    expect(result.applied).toHaveLength(1)
  })

  it('当てられなかった分は理由つきで受け取る', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { applied: [], skipped: [{ change: MOVE, reason: 'Shot が動いています' }] },
      }),
    )

    const result = await api().applyRoughCut(projectId, [MOVE])
    expect(result.skipped[0]?.reason).toBe('Shot が動いています')
  })

  it('**理由の無いスキップは通さない。** 何が残ったか分からなくなる', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { applied: [], skipped: [{ change: MOVE, reason: '' }] },
      }),
    )

    await expect(api().applyRoughCut(projectId, [MOVE])).rejects.toThrow()
  })
})
