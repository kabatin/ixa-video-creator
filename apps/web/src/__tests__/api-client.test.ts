import { WorkspaceId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '@/lib/api-client'
import { ApiError } from '@/lib/api-error'

const BASE_URL = 'http://127.0.0.1:3001'
const WORKSPACE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const PROJECT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW'

const projectJson = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  name: 'iXA CUP MUSIC VIDEO',
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  durationSec: 116,
  budgetUsd: null,
  styleGuide: '',
  status: 'planning',
  createdAt: '2026-09-16T01:02:03.000Z',
  updatedAt: '2026-09-16T01:02:03.000Z',
}

const requestBodyOf = (init: RequestInit | undefined): string =>
  typeof init?.body === 'string' ? init.body : ''

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createApiClient', () => {
  it('listProjects は封筒を剥がして Project をパースする', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [projectJson] }))

    const projects = await createApiClient(BASE_URL).listProjects(WORKSPACE_ID)

    expect(projects).toHaveLength(1)
    expect(projects[0]?.name).toBe('iXA CUP MUSIC VIDEO')
    expect(projects[0]?.resolution).toEqual({ width: 1920, height: 1080 })
    expect(projects[0]?.createdAt).toBeInstanceOf(Date)
    expect(projects[0]?.createdAt.toISOString()).toBe('2026-09-16T01:02:03.000Z')

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects?workspaceId=${WORKSPACE_ID}`)
  })

  it('createProject は POST してパース済み Project を返す', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: projectJson }))

    const project = await createApiClient(BASE_URL).createProject({
      workspaceId: WorkspaceId.parse(WORKSPACE_ID),
      name: 'iXA CUP MUSIC VIDEO',
      fps: 30,
      resolution: { width: 1920, height: 1080 },
      aspectRatio: '16:9',
    })

    expect(project.id).toBe(PROJECT_ID)
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.method).toBe('POST')
    expect(JSON.parse(requestBodyOf(init)) as unknown).toMatchObject({
      name: 'iXA CUP MUSIC VIDEO',
      styleGuide: '',
      budgetUsd: null,
    })
  })

  it('getProject は 404 を null にする', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'not found' }, 404))

    await expect(createApiClient(BASE_URL).getProject(PROJECT_ID)).resolves.toBeNull()
  })

  it('HTTP エラーはステータスと本文を含めて throw する', async () => {
    fetchMock.mockResolvedValue(
      new Response('database is on fire', { status: 500, statusText: 'Internal Server Error' }),
    )

    const error = await createApiClient(BASE_URL)
      .listProjects(WORKSPACE_ID)
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(500)
    expect((error as ApiError).message).toContain('500')
    expect((error as ApiError).message).toContain('database is on fire')
    expect((error as ApiError).message).toContain('/projects')
  })

  it('API がエラー封筒を返したら内容を含めて throw する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'workspace not found' }))

    await expect(createApiClient(BASE_URL).listProjects(WORKSPACE_ID)).rejects.toThrow(
      /workspace not found/u,
    )
  })

  it('fetch 自体が失敗したら transport エラーとして throw する', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    const error = await createApiClient(BASE_URL)
      .listProjects(WORKSPACE_ID)
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).isTransportError).toBe(true)
    expect((error as ApiError).message).toContain('ECONNREFUSED')
  })

  it('不正な形のレスポンスは zod が throw する', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [{ ...projectJson, fps: 12, resolution: { width: 0, height: -1 } }],
      }),
    )

    await expect(createApiClient(BASE_URL).listProjects(WORKSPACE_ID)).rejects.toThrow()
  })

  it('data が欠けているレスポンスも zod が throw する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }))

    await expect(createApiClient(BASE_URL).listProjects(WORKSPACE_ID)).rejects.toThrow()
  })

  it('JSON でないレスポンスは内容を含めて throw する', async () => {
    fetchMock.mockResolvedValue(new Response('<html>oops</html>', { status: 200 }))

    await expect(createApiClient(BASE_URL).listProjects(WORKSPACE_ID)).rejects.toThrow(
      /JSON ではありません/u,
    )
  })
})
