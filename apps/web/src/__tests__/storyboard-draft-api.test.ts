import {
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  StoryboardDraftItemId as StoryboardDraftItemIdSchema,
  StoryboardDraftRunId as StoryboardDraftRunIdSchema,
  newId,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { createRequester } from '@/lib/requester'
import {
  WireStoryboardDraftItem,
  WireStoryboardDraftRun,
  createStoryboardDraftApi,
} from '@/lib/storyboard-draft-api'

/**
 * 下書きの呼び出し口（P63-4）。
 * **経路と本文を固定する。** 採用は「Shot を列挙して渡す」以外の形にならないこと。
 */

const BASE_URL = 'https://api.test'
const projectId = newId(ProjectIdSchema)
const runId = newId(StoryboardDraftRunIdSchema)
const shotId = newId(ShotIdSchema)

const run = {
  id: runId,
  projectId,
  drafter: 'stub-storyboard-drafter',
  status: 'done',
  costUsd: 0,
  error: null,
  createdAt: '2026-09-18T00:00:00.000Z',
}

const item = {
  id: newId(StoryboardDraftItemIdSchema),
  runId,
  shotId,
  description: '決勝卓を引きで捉える',
  mood: '静かな緊張',
  reason: 'intro の静けさを保つため',
  adoptedAt: null,
  createdAt: '2026-09-18T00:00:00.000Z',
}

type Captured = {
  readonly url: string
  readonly method: string | undefined
  /** 送った本文。**本文を送らなかったときは null。** */
  readonly body: string | null
}

const urlOf = (input: RequestInfo | URL): string =>
  input instanceof URL ? input.href : typeof input === 'string' ? input : input.url

/** `fetch` を差し替えて、送った経路と本文を記録する。ネットワークには出ない。 */
const withFetch = (payload: unknown, status = 200): readonly Captured[] => {
  const captured: Captured[] = []
  const fetchMock: typeof fetch = (input, init) => {
    captured.push({
      url: urlOf(input),
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : null,
    })
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  globalThis.fetch = fetchMock
  return captured
}

const api = () => createStoryboardDraftApi(createRequester(BASE_URL))

describe('createStoryboardDraftApi', () => {
  it('下書きは POST で作り、本文を送らない', async () => {
    const captured = withFetch({ success: true, data: { run, items: [item] } })
    const result = await api().createDraft(projectId)

    expect(captured[0]?.url).toBe(`${BASE_URL}/projects/${projectId}/storyboard/drafts`)
    expect(captured[0]?.method).toBe('POST')
    expect(captured[0]?.body).toBeNull()
    expect(result.items).toHaveLength(1)
  })

  it('最新の下書きは GET で読む', async () => {
    const captured = withFetch({ success: true, data: { run, items: [item] } })
    const result = await api().getLatestDraft(projectId)

    expect(captured[0]?.url).toBe(`${BASE_URL}/projects/${projectId}/storyboard/drafts`)
    expect(captured[0]?.method).toBe('GET')
    expect(result.items).toHaveLength(1)
  })

  /** **run の null は「まだ一度も下書きしていない」。** 「案が 0 件」と混ぜない。 */
  it('まだ下書きしていない Project は run が null で返る', async () => {
    withFetch({ success: true, data: { run: null, items: [] } })
    const result = await api().getLatestDraft(projectId)

    expect(result.run).toBeNull()
    expect(result.items).toEqual([])
  })

  it('失敗した run も値として受け取る（HTTP のエラーにしない）', async () => {
    withFetch({
      success: true,
      data: {
        run: { ...run, status: 'failed', error: { code: 'cli_timeout', message: '終わらない' } },
        items: [],
      },
    })
    const result = await api().createDraft(projectId)

    expect(result.run.status).toBe('failed')
    expect(result.run.error?.code).toBe('cli_timeout')
  })

  /** **採用は Shot を列挙して渡す。** 本文が空になったら、それは別の操作になっている。 */
  it('採用は runId 付きの経路へ shotIds を送る', async () => {
    const captured = withFetch({
      success: true,
      data: {
        adopted: [{ ...item, adoptedAt: '2026-09-18T01:00:00.000Z' }],
        shots: [
          {
            id: shotId,
            code: 'A',
            description: '決勝卓を引きで捉える',
            mood: '静かな緊張',
            // 採用で入ったカメラ（ADR-0043）。**受け取らないと画面に出ない。**
            camera: {
              size: 'medium',
              angleH: null,
              angle: null,
              lensMm: null,
              movement: 'tilt',
              movementIntensity: 'moderate',
            },
          },
        ],
      },
    })
    const result = await api().adopt(projectId, runId, [shotId])

    expect(captured[0]?.url).toBe(
      `${BASE_URL}/projects/${projectId}/storyboard/drafts/${runId}/adopt`,
    )
    expect(JSON.parse(captured[0]?.body ?? 'null')).toEqual({ shotIds: [shotId] })
    expect(result.shots[0]?.description).toBe('決勝卓を引きで捉える')
    expect(result.shots[0]?.camera.movement).toBe('tilt')
  })

  it('封筒の形が違えば例外にする（黙って通さない）', async () => {
    withFetch({ success: true, data: { run, items: [{ ...item, reason: '' }] } })
    await expect(api().createDraft(projectId)).rejects.toThrow()
  })

  /** **`reason` だけを落とす。** 他の項目まで欠けると、別の理由で落ちて検査にならない。 */
  it('reason の無い案は受け取らない', async () => {
    const { id, runId: itemRunId, shotId: itemShotId, description, mood, createdAt } = item
    withFetch({
      success: true,
      data: {
        run,
        items: [
          {
            id,
            runId: itemRunId,
            shotId: itemShotId,
            description,
            mood,
            adoptedAt: null,
            createdAt,
          },
        ],
      },
    })

    await expect(api().createDraft(projectId)).rejects.toThrow()
  })

  it('HTTP の失敗は例外にする', async () => {
    withFetch({ success: false, error: 'リソースが見つかりません' }, 404)
    await expect(api().createDraft(projectId)).rejects.toThrow()
  })
})

describe('wire スキーマ', () => {
  it('adoptedAt の null を受け取れる（「まだ決めていない」）', () => {
    expect(WireStoryboardDraftItem.safeParse(item).success).toBe(true)
  })

  it('status は決められた 4 つだけ', () => {
    expect(WireStoryboardDraftRun.safeParse({ ...run, status: 'cancelled' }).success).toBe(false)
  })
})
