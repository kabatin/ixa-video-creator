import { OpenAPIHono } from '@hono/zod-openapi'
import { ShotId as ShotIdSchema, TransitionId as TransitionIdSchema, newId } from '@ixa/domain'
import { aShot, createInMemoryShotRepository } from '@ixa/generation/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import {
  DUPLICATE_TRANSITION_MESSAGE,
  EXISTING_INCOMING_MESSAGE,
  EXISTING_OUTGOING_MESSAGE,
  FOREIGN_SHOT_MESSAGE,
  SELF_TRANSITION_MESSAGE,
  TRANSITION_TOO_LONG_MESSAGE,
  transitionRoutes,
  type TransitionRoutesDeps,
} from '../routes/transitions.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import {
  createInMemoryTransitionRepository,
  type InMemoryTransitionRepository,
} from './in-memory-timeline-repositories.js'

/**
 * Transition ルートのテスト。実 DB には接続しない。
 * 尺は「つなぐ 2 つの Shot のうち短いほう」を上限にするので、
 * 2 つの Shot はわざと違う尺にしてある（同じ尺だと min の取り違えが素通りする）。
 */

type SuccessBody<T> = { success: true; data: T }
type ListBody<T> = { success: true; data: T[]; meta: { total: number } }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }

type TransitionBody = {
  id: string
  projectId: string
  fromShotId: string
  toShotId: string
  type: string
  durationSec: number
}

const project = aProject()
const otherProject = aProject({ name: '別の Project' })

/** 尺 4.000 秒。長いほう。 */
const shotA = aShot(project.id, { order: 0, code: 'A-01', startSec: 0, durationSec: 4 })
/** 尺 2.500 秒。短いほう = Transition の上限を決める側。 */
const shotB = aShot(project.id, { order: 1, code: 'A-02', startSec: 4, durationSec: 2.5 })
const shotC = aShot(project.id, { order: 2, code: 'A-03', startSec: 6.5, durationSec: 3 })
/** 他 Project の Shot。経路の Project と突き合わせて弾かれること。 */
const foreignShot = aShot(otherProject.id, { order: 0, code: 'X-01' })

let transitions: InMemoryTransitionRepository

const buildApp = (deps: TransitionRoutesDeps) => {
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', transitionRoutes(deps))
  registerErrorHandlers(app, createLogger('silent'))
  return app
}

let app: ReturnType<typeof buildApp>

const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T

const post = (projectId: string, payload: Record<string, unknown>) =>
  send('POST', `/projects/${projectId}/transitions`, payload)

const createTransition = async (
  overrides: Record<string, unknown> = {},
): Promise<TransitionBody> => {
  const res = await post(project.id, {
    fromShotId: shotA.id,
    toShotId: shotB.id,
    type: 'dissolve',
    durationSec: 0.5,
    ...overrides,
  })
  const body = await json<SuccessBody<TransitionBody>>(res)
  return body.data
}

beforeEach(() => {
  transitions = createInMemoryTransitionRepository()
  app = buildApp({
    transitions,
    shots: createInMemoryShotRepository([shotA, shotB, shotC, foreignShot]),
    projects: createInMemoryProjectRepository([project, otherProject]),
  })
})

describe('Transition の CRUD', () => {
  it('201 で作成し、経路の projectId が入る', async () => {
    const res = await post(project.id, {
      fromShotId: shotA.id,
      toShotId: shotB.id,
      type: 'dissolve',
      durationSec: 0.5,
    })
    expect(res.status).toBe(201)

    const body = await json<SuccessBody<TransitionBody>>(res)
    expect(body.data.projectId).toBe(project.id)
    expect(body.data.fromShotId).toBe(shotA.id)
    expect(body.data.toShotId).toBe(shotB.id)
    expect(body.data.type).toBe('dissolve')
    expect(body.data.durationSec).toBe(0.5)
  })

  it('durationSec を省略すると 0 になる', async () => {
    const created = await createTransition({ type: 'wipe', durationSec: undefined })
    expect(created.durationSec).toBe(0)
  })

  it('一覧は投入順で返り、meta.total が件数と一致する', async () => {
    await createTransition({ fromShotId: shotB.id, toShotId: shotC.id, durationSec: 0.25 })
    await createTransition({ fromShotId: shotA.id, toShotId: shotB.id })

    const res = await send('GET', `/projects/${project.id}/transitions`)
    expect(res.status).toBe(200)

    const body = await json<ListBody<TransitionBody>>(res)
    expect(body.data.map((t) => t.fromShotId)).toEqual([shotB.id, shotA.id])
    expect(body.meta.total).toBe(2)
  })

  it('他 Project の Transition は一覧に混ざらない', async () => {
    await createTransition()

    const res = await send('GET', `/projects/${otherProject.id}/transitions`)
    const body = await json<ListBody<TransitionBody>>(res)
    expect(body.data).toEqual([])
    expect(body.meta.total).toBe(0)
  })

  it('DELETE は 204 を返し、一覧から消える', async () => {
    const created = await createTransition()

    const res = await send('DELETE', `/transitions/${created.id}`)
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')

    const list = await json<ListBody<TransitionBody>>(
      await send('GET', `/projects/${project.id}/transitions`),
    )
    expect(list.data).toEqual([])
  })

  it('削除すれば同じ 2 つの Shot を繋ぎ直せる（PATCH の代わりの経路）', async () => {
    const created = await createTransition({ type: 'dissolve', durationSec: 0.5 })
    expect((await send('DELETE', `/transitions/${created.id}`)).status).toBe(204)

    const replaced = await createTransition({ type: 'dip_to_black', durationSec: 1 })
    expect(replaced.type).toBe('dip_to_black')
    expect(replaced.durationSec).toBe(1)
    expect(transitions.snapshot()).toHaveLength(1)
  })

  it('存在しない Transition の DELETE は 404', async () => {
    const res = await send('DELETE', `/transitions/${newId(TransitionIdSchema)}`)
    expect(res.status).toBe(404)
  })
})

describe('Project の実在確認', () => {
  it('存在しない Project の一覧は 404（空配列にしない）', async () => {
    const res = await send('GET', `/projects/${aProject().id}/transitions`)
    expect(res.status).toBe(404)
  })

  it('存在しない Project への作成は 404', async () => {
    const res = await post(aProject().id, {
      fromShotId: shotA.id,
      toShotId: shotB.id,
      type: 'cut',
    })
    expect(res.status).toBe(404)
  })
})

describe('繋ぐ Shot の検証', () => {
  it('存在しない Shot は 422 で、どちらの端が悪いか分かる', async () => {
    const res = await post(project.id, {
      fromShotId: shotA.id,
      toShotId: newId(ShotIdSchema),
      type: 'dissolve',
      durationSec: 0.5,
    })
    expect(res.status).toBe(422)

    const body = await json<ErrorBody>(res)
    expect(body.fields?.toShotId).toEqual([FOREIGN_SHOT_MESSAGE])
    expect(body.fields?.fromShotId).toBeUndefined()
  })

  it('他 Project の Shot は 422', async () => {
    const res = await post(project.id, {
      fromShotId: foreignShot.id,
      toShotId: shotB.id,
      type: 'dissolve',
      durationSec: 0.5,
    })
    expect(res.status).toBe(422)

    const body = await json<ErrorBody>(res)
    expect(body.fields?.fromShotId).toEqual([FOREIGN_SHOT_MESSAGE])
  })

  it('両端とも駄目なら 2 つまとめて返る', async () => {
    const res = await post(project.id, {
      fromShotId: foreignShot.id,
      toShotId: newId(ShotIdSchema),
      type: 'dissolve',
      durationSec: 0.5,
    })
    expect(res.status).toBe(422)

    const body = await json<ErrorBody>(res)
    expect(body.fields?.fromShotId).toEqual([FOREIGN_SHOT_MESSAGE])
    expect(body.fields?.toShotId).toEqual([FOREIGN_SHOT_MESSAGE])
  })

  it('自分自身への遷移は 422', async () => {
    const res = await post(project.id, {
      fromShotId: shotA.id,
      toShotId: shotA.id,
      type: 'dissolve',
      durationSec: 0.5,
    })
    expect(res.status).toBe(422)

    const body = await json<ErrorBody>(res)
    expect(body.fields?.toShotId).toEqual([SELF_TRANSITION_MESSAGE])
    expect(transitions.snapshot()).toEqual([])
  })

  it('同じ (from, to) の 2 本目は 422', async () => {
    await createTransition()

    const res = await post(project.id, {
      fromShotId: shotA.id,
      toShotId: shotB.id,
      type: 'dip_to_white',
      durationSec: 0.25,
    })
    expect(res.status).toBe(422)

    const body = await json<ErrorBody>(res)
    expect(body.fields?.toShotId).toEqual([DUPLICATE_TRANSITION_MESSAGE])
    expect(transitions.snapshot()).toHaveLength(1)
  })

  it('向きが逆なら別の Transition として作れる', async () => {
    await createTransition({ fromShotId: shotA.id, toShotId: shotB.id })

    const res = await post(project.id, {
      fromShotId: shotB.id,
      toShotId: shotA.id,
      type: 'dissolve',
      durationSec: 0.5,
    })
    expect(res.status).toBe(201)
    expect(transitions.snapshot()).toHaveLength(2)
  })
})

describe('尺の検証', () => {
  it('短いほうの Shot より長い尺は 422（to が短い場合）', async () => {
    const res = await post(project.id, {
      fromShotId: shotA.id, // 4.0 秒
      toShotId: shotB.id, // 2.5 秒 ← こちらが上限
      type: 'dissolve',
      durationSec: 3,
    })
    expect(res.status).toBe(422)

    const body = await json<ErrorBody>(res)
    expect(body.fields?.durationSec?.[0]).toContain(TRANSITION_TOO_LONG_MESSAGE)
    expect(body.fields?.durationSec?.[0]).toContain('2.500')
    expect(transitions.snapshot()).toEqual([])
  })

  it('短いほうの Shot より長い尺は 422（from が短い場合）', async () => {
    const res = await post(project.id, {
      fromShotId: shotB.id, // 2.5 秒 ← こちらが上限
      toShotId: shotC.id, // 3.0 秒
      type: 'dissolve',
      durationSec: 2.75,
    })
    expect(res.status).toBe(422)

    const body = await json<ErrorBody>(res)
    expect(body.fields?.durationSec?.[0]).toContain('2.500')
  })

  it('短いほうの尺ちょうどは通る（境界を弾かない）', async () => {
    const res = await post(project.id, {
      fromShotId: shotA.id,
      toShotId: shotB.id,
      type: 'dissolve',
      durationSec: 2.5,
    })
    expect(res.status).toBe(201)

    const body = await json<SuccessBody<TransitionBody>>(res)
    expect(body.data.durationSec).toBe(2.5)
  })

  it('負の尺は zod が 422 で弾く', async () => {
    const res = await post(project.id, {
      fromShotId: shotA.id,
      toShotId: shotB.id,
      type: 'dissolve',
      durationSec: -1,
    })
    expect(res.status).toBe(422)
    expect(transitions.snapshot()).toEqual([])
  })

  it('未知の type は zod が 422 で弾く', async () => {
    const res = await post(project.id, {
      fromShotId: shotA.id,
      toShotId: shotB.id,
      type: 'star_wipe',
      durationSec: 0.5,
    })
    expect(res.status).toBe(422)
  })
})

describe('cut の尺', () => {
  it('cut は尺を送っても 0 に正規化され、その 0 が応答に載る', async () => {
    const res = await post(project.id, {
      fromShotId: shotA.id,
      toShotId: shotB.id,
      type: 'cut',
      durationSec: 0.5,
    })
    expect(res.status).toBe(201)

    const body = await json<SuccessBody<TransitionBody>>(res)
    expect(body.data.durationSec).toBe(0)
    expect(transitions.snapshot()[0]?.durationSec).toBe(0)
  })

  it('cut は Shot の尺を超える値でも 422 にならない（絵に出ない値で止めない）', async () => {
    const res = await post(project.id, {
      fromShotId: shotA.id,
      toShotId: shotB.id,
      type: 'cut',
      durationSec: 99,
    })
    expect(res.status).toBe(201)

    const body = await json<SuccessBody<TransitionBody>>(res)
    expect(body.data.durationSec).toBe(0)
  })

  it('cut 以外は送った尺がそのまま残る', async () => {
    const created = await createTransition({ type: 'dip_to_black', durationSec: 1.25 })
    expect(created.durationSec).toBe(1.25)
  })
})

describe('Shot がつながる先と元は 1 つだけ（Architect 追加）', () => {
  /**
   * レンダラは Shot から出る Transition を 1 本しか採らない
   * （packages/render/src/plan.ts の findOutgoing）。作った時点で弾かないと、
   * 2 本目が絵に出ないことにレンダリングまで気づけない。
   */
  it('同じ Shot から 2 本目の Transition は作れない', async () => {
    await createTransition({ fromShotId: shotA.id, toShotId: shotB.id })

    const res = await post(project.id, {
      fromShotId: shotA.id,
      toShotId: shotC.id,
      type: 'dissolve',
      durationSec: 0.5,
    })

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.fromShotId).toEqual([EXISTING_OUTGOING_MESSAGE])
    expect(transitions.snapshot()).toHaveLength(1)
  })

  it('同じ Shot へ 2 本目の Transition は作れない', async () => {
    await createTransition({ fromShotId: shotA.id, toShotId: shotC.id })

    const res = await post(project.id, {
      fromShotId: shotB.id,
      toShotId: shotC.id,
      type: 'dissolve',
      durationSec: 0.5,
    })

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.toShotId).toEqual([EXISTING_INCOMING_MESSAGE])
    expect(transitions.snapshot()).toHaveLength(1)
  })

  it('同じ組の重複は、出入りの重複より具体的なメッセージを返す', async () => {
    await createTransition({ fromShotId: shotA.id, toShotId: shotB.id })

    const res = await post(project.id, {
      fromShotId: shotA.id,
      toShotId: shotB.id,
      type: 'wipe',
      durationSec: 0.2,
    })

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.toShotId).toEqual([DUPLICATE_TRANSITION_MESSAGE])
  })

  it('削除すれば付け替えられる', async () => {
    const first = await createTransition({ fromShotId: shotA.id, toShotId: shotB.id })

    expect((await send('DELETE', `/transitions/${first.id}`)).status).toBe(204)

    const res = await post(project.id, {
      fromShotId: shotA.id,
      toShotId: shotC.id,
      type: 'dissolve',
      durationSec: 0.5,
    })

    expect(res.status).toBe(201)
    expect(transitions.snapshot()).toHaveLength(1)
  })
})
