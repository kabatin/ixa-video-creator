import { ProjectId, RenderJobId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_ID, PROJECT_ID, SHOT_ID } from '@/__tests__/fixtures'
import { ApiError } from '@/lib/api-error'
import { createRenderApi, FULL_SCOPE, parseRenderRejection } from '@/lib/render-api'
import { createRequester } from '@/lib/requester'

const BASE_URL = 'http://127.0.0.1:3001'
const RENDER_JOB_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC0'

const projectId = ProjectId.parse(PROJECT_ID)
const renderJobId = RenderJobId.parse(RENDER_JOB_ID)

const jobJson = {
  id: RENDER_JOB_ID,
  projectId: PROJECT_ID,
  scope: { type: 'full' },
  preset: 'master_1080p',
  status: 'rendering',
  progress: 0.42,
  outputAssetId: null,
  error: null,
  createdAt: '2026-09-17T02:00:00.000Z',
  finishedAt: null,
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const requestBodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined

const fetchMock = vi.fn<typeof fetch>()

const api = () => createRenderApi(createRequester(BASE_URL))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('書き出しの投入', () => {
  /** 一部だけを書き出す（制作者 2026-10-02「選択した Shot だけを動画として出力」）。 */
  it('範囲を渡せば scope=range で POST する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { renderJobId: RENDER_JOB_ID, warnings: [] } }, 202))

    await api().startRender(projectId, 'preview_720p', { type: 'range', start: 4, end: 12 })

    expect(requestBodyOf(fetchMock.mock.calls[0]?.[1])).toEqual({
      preset: 'preview_720p',
      scope: { type: 'range', start: 4, end: 12 },
    })
  })

  it('プリセットと scope=full を POST し、受理された ID と警告を返す', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          success: true,
          data: {
            renderJobId: RENDER_JOB_ID,
            warnings: [
              {
                severity: 'warning',
                code: 'shot_gap',
                message: 'Shot S01-010 と Shot S01-020 の間に 0.500s の隙間がある',
                shotId: SHOT_ID,
              },
            ],
          },
        },
        202,
      ),
    )

    const outcome = await api().startRender(projectId, 'master_1080p')

    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') throw new Error('accepted のはず')
    expect(outcome.renderJobId).toBe(RENDER_JOB_ID)
    expect(outcome.warnings).toHaveLength(1)
    expect(outcome.warnings[0]?.code).toBe('shot_gap')

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/render`)
    expect(init?.method).toBe('POST')
    expect(requestBodyOf(init)).toEqual({ preset: 'master_1080p', scope: { type: 'full' } })
  })

  it('scope は常に full。部分書き出しは送らない', () => {
    expect(FULL_SCOPE).toEqual({ type: 'full' })
  })

  it('422 は例外にせず、拒否理由を値として返す', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: '入力の検証に失敗しました',
          fields: {
            timeline: [
              'Shot S01-010 (0.000s–4.000s) と Shot S01-020 (2.000s–6.000s) の時間が重なっている',
              'Shot S01-030 の編集尺が 0 以下（0.000s）',
            ],
          },
        },
        422,
      ),
    )

    const outcome = await api().startRender(projectId, 'preview_720p')

    expect(outcome.kind).toBe('rejected')
    if (outcome.kind !== 'rejected') throw new Error('rejected のはず')
    expect(outcome.rejection.message).toBe('入力の検証に失敗しました')
    expect(outcome.rejection.fields.timeline).toHaveLength(2)
  })

  it('422 でも本文を読めなければ握り潰さず例外を投げ直す', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>gateway</html>', {
        status: 422,
        headers: { 'content-type': 'text/html' },
      }),
    )

    await expect(api().startRender(projectId, 'preview_720p')).rejects.toBeInstanceOf(ApiError)
  })

  it('422 以外の失敗は例外のまま伝える', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: 'サーバ内部でエラーが発生しました' }, 500),
    )

    await expect(api().startRender(projectId, 'master_4k')).rejects.toBeInstanceOf(ApiError)
  })

  it('接続できないときも例外にする（黙って受理扱いにしない）', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(api().startRender(projectId, 'master_4k')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('拒否理由の読み取り', () => {
  it('JSON でない本文は null を返す', () => {
    expect(parseRenderRejection('not json')).toBeNull()
  })

  it('成功の封筒は拒否ではないので null を返す', () => {
    expect(parseRenderRejection(JSON.stringify({ success: true, data: {} }))).toBeNull()
  })

  it('fields が無い失敗も拒否として読む', () => {
    const rejection = parseRenderRejection(
      JSON.stringify({ success: false, error: 'リソースが見つかりません' }),
    )

    expect(rejection?.message).toBe('リソースが見つかりません')
    expect(rejection?.fields).toEqual({})
  })
})

describe('ジョブの参照', () => {
  it('一覧を引き、日時を Date に直す', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [
          {
            ...jobJson,
            status: 'succeeded',
            progress: 1,
            outputAssetId: MEDIA_ID,
            finishedAt: '2026-09-17T02:04:00.000Z',
          },
        ],
        meta: { total: 1 },
      }),
    )

    const jobs = await api().listRenderJobs(projectId)

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE_URL}/projects/${PROJECT_ID}/renders`)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.createdAt).toBeInstanceOf(Date)
    expect(jobs[0]?.finishedAt?.toISOString()).toBe('2026-09-17T02:04:00.000Z')
    expect(jobs[0]?.outputAssetId).toBe(MEDIA_ID)
  })

  it('1 件を引いて進捗を返す', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: jobJson }))

    const job = await api().getRenderJob(renderJobId)

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE_URL}/renders/${RENDER_JOB_ID}`)
    expect(job.status).toBe('rendering')
    expect(job.progress).toBeCloseTo(0.42)
    expect(job.finishedAt).toBeNull()
  })

  it('知らない status は検証で弾く（画面に未知の状態を通さない）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { ...jobJson, status: 'x' } }))

    await expect(api().getRenderJob(renderJobId)).rejects.toThrow()
  })
})

/**
 * 実際に動いている API から取った応答をそのまま検証する。
 * モック同士の会話で形を決めると、実物とズレていても気付けない（lessons L-007）。
 */
describe('実データの形（稼働中の API から取得）', () => {
  it('完了したジョブをそのまま読める', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [
          {
            id: '01M2MJE9X75A8RTG0QAG0ETVWS',
            projectId: '01M2M3CEK506X6FRYYW9R4T5HT',
            scope: { type: 'full' },
            preset: 'preview_720p',
            status: 'succeeded',
            progress: 1,
            outputAssetId: '01M2MJFFEV2M69C51B145VYSGV',
            error: null,
            createdAt: '2026-09-16T07:38:30.695Z',
            finishedAt: '2026-09-16T07:39:09.155Z',
          },
        ],
        meta: { total: 1 },
      }),
    )

    const jobs = await api().listRenderJobs(projectId)

    expect(jobs[0]?.status).toBe('succeeded')
    expect(jobs[0]?.scope).toEqual({ type: 'full' })
  })

  it('タイムラインの重なり 72 件を拒否として受け取る', async () => {
    const timeline = Array.from(
      { length: 72 },
      (_, index) =>
        `Shot VERSE-${String(index)} (40.031s–41.030s) と Shot VERSE-17 (40.031s–42.028s) の時間が重なっている`,
    )
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: '入力の検証に失敗しました', fields: { timeline } }, 422),
    )

    const outcome = await api().startRender(projectId, 'preview_720p')

    expect(outcome.kind).toBe('rejected')
    if (outcome.kind !== 'rejected') throw new Error('rejected のはず')
    expect(outcome.rejection.fields.timeline).toHaveLength(72)
  })

  it('部分書き出しの拒否は scope に入る（画面からは送らないが、形は受け取れる）', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: '入力の検証に失敗しました',
          fields: {
            scope: ['Phase 1 では scope.type=full のみ対応しています（range / shot は未対応）'],
          },
        },
        422,
      ),
    )

    const outcome = await api().startRender(projectId, 'preview_720p')

    expect(outcome.kind).toBe('rejected')
    if (outcome.kind !== 'rejected') throw new Error('rejected のはず')
    expect(outcome.rejection.fields.scope?.[0]).toContain('full のみ')
  })
})
