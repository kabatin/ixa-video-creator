import { ProjectId, ShotId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JOB_ID, LOCATION_ID, PROJECT_ID, SHOT_ID, TAKE_ID, shotJson } from '@/__tests__/fixtures'
import { ApiError } from '@/lib/api-error'
import { createRequester } from '@/lib/requester'
import { summarizeBulkResult } from '@/lib/shot-bulk'
import { createShotBulkApi, parseBulkGenerateRejection } from '@/lib/shot-bulk-api'

const BASE_URL = 'http://127.0.0.1:3001'

const projectId = ProjectId.parse(PROJECT_ID)
const shotId = ShotId.parse(SHOT_ID)
const otherShotId = ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA0')

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const requestBodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined

const fetchMock = vi.fn<typeof fetch>()

const api = () => createShotBulkApi(createRequester(BASE_URL))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('一括生成', () => {
  const accepted = {
    success: true,
    data: {
      results: [
        { shotId: SHOT_ID, ok: true, jobIds: [JOB_ID], resolvedModel: 'kling-v2' },
        {
          shotId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
          ok: false,
          reason: '仕様を組めません: Look が見つかりません',
        },
      ],
      estimatedTotalUsd: 3.2,
      enqueuedCount: 1,
    },
  }

  it('経路と本文を固定し、1 件ずつの結果を返す', async () => {
    fetchMock.mockResolvedValue(jsonResponse(accepted, 202))

    const result = await api().bulkGenerateShots(projectId, {
      shotIds: [shotId, otherShotId],
      model: 'AUTO',
      count: 2,
    })

    expect(result.enqueuedCount).toBe(1)
    expect(result.estimatedTotalUsd).toBe(3.2)
    expect(result.results).toHaveLength(2)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/shots/bulk/generate`)
    expect(init?.method).toBe('POST')
    expect(requestBodyOf(init)).toEqual({
      shotIds: [SHOT_ID, '01ARZ3NDEKTSV4RRFFQ69G5FA0'],
      model: 'AUTO',
      count: 2,
    })
  })

  it('成功と失敗を型で見分けられる', async () => {
    fetchMock.mockResolvedValue(jsonResponse(accepted, 202))

    const { results } = await api().bulkGenerateShots(projectId, {
      shotIds: [shotId, otherShotId],
      model: 'AUTO',
      count: 1,
    })

    const first = results[0]
    const second = results[1]
    expect(first?.ok === true && first.jobIds).toEqual([JOB_ID])
    expect(second?.ok === false && second.reason).toContain('Look が見つかりません')
  })

  /** 理由の無い失敗を受け取ると、画面は「1 件失敗」としか言えなくなる（L-015）。 */
  it('理由の無い失敗を受け取らない', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { results: [{ shotId: SHOT_ID, ok: false }], estimatedTotalUsd: 0, enqueuedCount: 0 },
      }),
    )

    await expect(
      api().bulkGenerateShots(projectId, { shotIds: [shotId], model: 'AUTO', count: 1 }),
    ).rejects.toThrow()
  })

  it('空文字の理由も受け取らない', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          results: [{ shotId: SHOT_ID, ok: false, reason: '' }],
          estimatedTotalUsd: 0,
          enqueuedCount: 0,
        },
      }),
    )

    await expect(
      api().bulkGenerateShots(projectId, { shotIds: [shotId], model: 'AUTO', count: 1 }),
    ).rejects.toThrow()
  })

  /**
   * 上限はサーバの持ち物。画面で写すと片方だけ直る日が来てズレる（L-016）。
   * 201 件でもそのまま送り、返ってきた理由を出す。
   */
  it('201 件でも画面側で止めず、そのままサーバへ送る', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: 'shotIds は 200 件までです' }, 422),
    )
    const many = Array.from({ length: 201 }, () => shotId)

    await expect(
      api().bulkGenerateShots(projectId, { shotIds: many, model: 'AUTO', count: 1 }),
    ).rejects.toThrow()

    const sent = requestBodyOf(fetchMock.mock.calls[0]?.[1]) as { shotIds: string[] }
    expect(sent.shotIds).toHaveLength(201)
  })

  it('入力の配列を書き換えない', async () => {
    fetchMock.mockResolvedValue(jsonResponse(accepted, 202))
    const shotIds = [shotId, otherShotId]

    await api().bulkGenerateShots(projectId, { shotIds, model: 'AUTO', count: 1 })

    expect(shotIds).toEqual([shotId, otherShotId])
  })

  it('count が上限を超えたら送る前に落ちる', async () => {
    await expect(
      api().bulkGenerateShots(projectId, { shotIds: [shotId], model: 'AUTO', count: 9 }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('予算で拒否されたとき', () => {
  it('422 は例外になり、理由と合計・上限を取り出せる', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: '合計 $12.00 が上限 $6.00 を超えるため、1 件も投入していません',
          fields: {
            cost: ['request'],
            // API は既存の `fail(message, fields)` の封筒に合わせ、文字列の配列で返す。
            estimatedTotalUsd: ['12.000'],
            limitUsd: ['6.000'],
          },
        },
        422,
      ),
    )

    const caught = await api()
      .bulkGenerateShots(projectId, { shotIds: [shotId], model: 'AUTO', count: 4 })
      .catch((error: unknown) => error)

    const rejection = parseBulkGenerateRejection(caught)
    expect(rejection?.message).toContain('1 件も投入していません')
    expect(rejection?.estimatedTotalUsd).toBe(12)
    expect(rejection?.limitUsd).toBe(6)
    expect(rejection?.limit).toBe('request')
  })

  /**
   * **「上限なし」と「上限が分からない」を同じ null に畳まない**（lessons L-015）。
   * 前者は選択を減らしても直らない。後者は表示を控えるべきもの。
   * 畳むと画面の出し方が逆になる。
   *
   * **いまの API はこの本文を返さない**（422 はプロジェクト予算の超過だけで、
   * 予算未設定なら 422 自体が起きない）。生きた契約ではなく、読み分けの防御を固定する。
   */
  it('上限が「無制限」なら unlimited。付いてこないときの null と区別する', () => {
    const error = new ApiError(
      '予算を超えます',
      422,
      JSON.stringify({
        success: false,
        error: '予算を超えます',
        fields: { cost: ['shot'], estimatedTotalUsd: ['40.500'], limitUsd: ['無制限'] },
      }),
    )

    const rejection = parseBulkGenerateRejection(error)

    expect(rejection?.estimatedTotalUsd).toBe(40.5)
    expect(rejection?.limitUsd).toBe('unlimited')
    expect(rejection?.limit).toBe('shot')
  })

  it('どの上限に当たったかを返す', () => {
    const error = new ApiError(
      'boom',
      422,
      JSON.stringify({ success: false, error: '予算を超えます', fields: { cost: ['request'] } }),
    )

    expect(parseBulkGenerateRejection(error)?.limit).toBe('request')
  })

  /** 未知の種別を既知のどれかに寄せると、画面が誤った緩め方を勧める。 */
  it('知らない種別は null。既知のどれかに寄せない', () => {
    const error = new ApiError(
      'boom',
      422,
      JSON.stringify({ success: false, error: '予算を超えます', fields: { cost: ['謎'] } }),
    )

    expect(parseBulkGenerateRejection(error)?.limit).toBeNull()
  })

  it('合計と上限が付かなくても、理由は落とさない', () => {
    const error = new ApiError(
      'boom',
      422,
      JSON.stringify({ success: false, error: '予算を超えます' }),
      {},
    )

    const rejection = parseBulkGenerateRejection(error)

    expect(rejection?.message).toBe('予算を超えます')
    expect(rejection?.estimatedTotalUsd).toBeNull()
    expect(rejection?.limitUsd).toBeNull()
    expect(rejection?.limit).toBeNull()
  })

  it('422 以外・読めない本文は null を返す。呼び出し側が元の例外を投げ直せるようにする', () => {
    expect(parseBulkGenerateRejection(new ApiError('boom', 500, '{}', {}))).toBeNull()
    expect(parseBulkGenerateRejection(new ApiError('boom', 422, 'not json', {}))).toBeNull()
    expect(parseBulkGenerateRejection(new Error('boom'))).toBeNull()
  })

  it('500 は握り潰さない', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'boom' }, 500))

    await expect(
      api().bulkGenerateShots(projectId, { shotIds: [shotId], model: 'AUTO', count: 1 }),
    ).rejects.toThrow()
  })
})

describe('一括採用', () => {
  it('規則を送り、採用できなかった件は理由つきで返る', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          results: [
            { shotId: SHOT_ID, ok: true, takeId: TAKE_ID, status: 'review' },
            { shotId: '01ARZ3NDEKTSV4RRFFQ69G5FA0', ok: false, reason: 'Take がありません' },
          ],
        },
      }),
    )

    const result = await api().bulkSelectTakes(projectId, {
      shotIds: [shotId, otherShotId],
      rule: 'only',
    })

    const first = result.results[0]
    expect(first?.ok === true && first.takeId).toBe(TAKE_ID)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/shots/bulk/select-take`)
    expect(init?.method).toBe('POST')
    expect(requestBodyOf(init)).toEqual({
      shotIds: [SHOT_ID, '01ARZ3NDEKTSV4RRFFQ69G5FA0'],
      rule: 'only',
    })
  })

  it('知らない規則は送る前に落ちる', async () => {
    await expect(
      // @ts-expect-error 規則は 'only' | 'latest' の 2 つだけ
      api().bulkSelectTakes(projectId, { shotIds: [shotId], rule: 'newest' }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('一括で採用を外す', () => {
  it('shotIds だけを送り、外したあとの状態を返す', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          results: [
            { shotId: SHOT_ID, ok: true, status: 'ready' },
            { shotId: '01ARZ3NDEKTSV4RRFFQ69G5FA0', ok: false, reason: '採用していません' },
          ],
        },
      }),
    )

    const result = await api().bulkUnselectTakes(projectId, [shotId, otherShotId])

    const first = result.results[0]
    expect(first?.ok === true && first.status).toBe('ready')

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/shots/bulk/unselect-take`)
    expect(init?.method).toBe('POST')
    // **規則は無い。** 外すのに選びようは無いので、余計な欄を送らない
    expect(requestBodyOf(init)).toEqual({ shotIds: [SHOT_ID, '01ARZ3NDEKTSV4RRFFQ69G5FA0'] })
  })

  /** Take は消えないので `takeId` は返らない。返ってきても受け取らない。 */
  it('理由の無い失敗は受け取らない', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { results: [{ shotId: SHOT_ID, ok: false }] },
      }),
    )

    await expect(api().bulkUnselectTakes(projectId, [shotId])).rejects.toThrow()
  })
})

describe('一括変更', () => {
  it('PATCH で patch を送り、変わった Shot を返す', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { results: [{ shotId: SHOT_ID, ok: true, shot: shotJson }] },
      }),
    )

    const result = await api().bulkUpdateShots(projectId, {
      shotIds: [shotId],
      patch: { mood: 'tense', locationId: LOCATION_ID },
    })

    const first = result.results[0]
    expect(first?.ok === true && first.shot.code).toBe('S01-010')
    expect(first?.ok === true && first.shot.createdAt).toBeInstanceOf(Date)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/shots/bulk`)
    expect(init?.method).toBe('PATCH')
    expect(requestBodyOf(init)).toEqual({
      shotIds: [SHOT_ID],
      patch: { mood: 'tense', locationId: LOCATION_ID },
    })
  })

  it('場所を外す null を送れる', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { results: [{ shotId: SHOT_ID, ok: true, shot: shotJson }] },
      }),
    )

    await api().bulkUpdateShots(projectId, { shotIds: [shotId], patch: { locationId: null } })

    expect(requestBodyOf(fetchMock.mock.calls[0]?.[1])).toEqual({
      shotIds: [SHOT_ID],
      patch: { locationId: null },
    })
  })

  /** 尺と順序を一括で揃えるとタイムラインが壊れる。型で止め、通り抜けても本文に載せない。 */
  it('一括で変えてよい列の外は本文に載せない', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { results: [{ shotId: SHOT_ID, ok: true, shot: shotJson }] },
      }),
    )

    await api().bulkUpdateShots(projectId, {
      shotIds: [shotId],
      // @ts-expect-error 尺は一括で揃えない
      patch: { mood: 'tense', durationSec: 9 },
    })

    expect(requestBodyOf(fetchMock.mock.calls[0]?.[1])).toEqual({
      shotIds: [SHOT_ID],
      patch: { mood: 'tense' },
    })
  })

  /**
   * カメラは部分更新。全体の置換にすると「景別だけ変える」つもりで
   * 27 件の `lensMm` / `angle` がまとめて消える。
   */
  it('カメラは送った項目だけを本文に載せる', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { results: [{ shotId: SHOT_ID, ok: true, shot: shotJson }] },
      }),
    )

    await api().bulkUpdateShots(projectId, {
      shotIds: [shotId],
      patch: { camera: { size: 'closeup' } },
    })

    expect(requestBodyOf(fetchMock.mock.calls[0]?.[1])).toEqual({
      shotIds: [SHOT_ID],
      patch: { camera: { size: 'closeup' } },
    })
  })

  it('カメラの項目は null で外せる', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { results: [{ shotId: SHOT_ID, ok: true, shot: shotJson }] },
      }),
    )

    await api().bulkUpdateShots(projectId, {
      shotIds: [shotId],
      patch: { camera: { movement: null } },
    })

    expect(requestBodyOf(fetchMock.mock.calls[0]?.[1])).toEqual({
      shotIds: [SHOT_ID],
      patch: { camera: { movement: null } },
    })
  })

  /** 黙って落とすと「変えたのに変わらない」になる。サーバも 422 で弾く。 */
  it('知らないカメラの項目は送る前に落ちる', async () => {
    await expect(
      // @ts-expect-error ShotCamera に無い項目
      api().bulkUpdateShots(projectId, { shotIds: [shotId], patch: { camera: { zoom: 2 } } }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('要約との接続', () => {
  /** Wire の結果をそのまま要約に渡せること。渡せなければ画面で詰め替える羽目になる。 */
  it('3 経路の結果をそのまま summarizeBulkResult に渡せる', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          results: [
            { shotId: SHOT_ID, ok: true, takeId: TAKE_ID, status: 'review' },
            { shotId: '01ARZ3NDEKTSV4RRFFQ69G5FA0', ok: false, reason: 'Take がありません' },
          ],
        },
      }),
    )

    const { results } = await api().bulkSelectTakes(projectId, {
      shotIds: [shotId, otherShotId],
      rule: 'latest',
    })
    const summary = summarizeBulkResult('select-take', results, [{ id: shotId, code: 'CUT-01' }])

    expect(summary.text).toBe(
      [
        '2 件中 1 件を採用しました。',
        '失敗 1 件:',
        `  01ARZ3NDEKTSV4RRFFQ69G5FA0 — Take がありません`,
      ].join('\n'),
    )
  })
})
