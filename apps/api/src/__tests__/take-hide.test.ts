import type { Shot, Take } from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { ADOPTED_TAKE_CANNOT_HIDE } from '../routes/take-hide.js'
import { baseAppDeps } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectEvents } from './in-memory-project-events.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import type { ErrorBody, Ok } from './shot-test-support.js'

/**
 * Take を消す（制作者 2026-10-01「Takeを消す口」）。Take は追記のみ（ADR-0003）なので、**見えなくする**。
 * 行も中身も残る（記録と費用）。採用中の Take は断る。
 */

type HideData = { shot: { id: string; status: string } }

const build = (options: { readonly adopted?: boolean; readonly status?: Shot['status'] } = {}) => {
  const project = aProject()
  const base = aShot(project.id, { status: options.status ?? 'review' })
  const first = aTake(base, 'a'.repeat(64), { index: 1 })
  const second = aTake(base, 'b'.repeat(64), { index: 2 })
  const shot = options.adopted === true ? { ...base, selectedTakeId: first.id, status: 'approved' as const } : base
  const shots = createInMemoryShotRepository([shot])
  const takes = createInMemoryTakeRepository([first, second])
  const events = createInMemoryProjectEvents()
  const app = createApp({
    ...baseAppDeps(),
    projects: createInMemoryProjectRepository([project]),
    shots,
    takes,
    events,
  })
  const hide = (take: Take) => app.request(`/takes/${take.id}`, { method: 'DELETE' })
  return { app, shot, first, second, shots, takes, events, hide }
}

describe('DELETE /takes/:id（見えなくする）', () => {
  it('一覧から見えなくなる。行は残る（記録と費用）', async () => {
    const f = build()

    const res = await f.hide(f.first)

    expect(res.status).toBe(200)
    expect((await f.takes.findByShot(f.shot.id)).map((take) => take.id)).toEqual([f.second.id])
    expect(f.takes.snapshot()).toHaveLength(2)
    expect(await f.takes.sumCostByShot(f.shot.id)).toBeCloseTo(f.first.costUsd + f.second.costUsd)
    const list = (await (await f.app.request(`/shots/${f.shot.id}/takes`)).json()) as Ok<{ id: string }[]>
    expect(list.data.map((take) => take.id)).toEqual([f.second.id])
  })

  it('採用中の Take は断る（採用を外してから）', async () => {
    const f = build({ adopted: true })

    const res = await f.hide(f.first)

    expect(res.status).toBe(409)
    expect(((await res.json()) as ErrorBody).error).toBe(ADOPTED_TAKE_CANNOT_HIDE)
    expect(await f.takes.findByShot(f.shot.id)).toHaveLength(2)
  })

  it('最後の 1 本を消したら Shot は下書きに戻す（要判断にしない）', async () => {
    const f = build()
    await f.hide(f.first)

    const res = await f.hide(f.second)

    expect(((await res.json()) as Ok<HideData>).data.shot.status).toBe('draft')
    expect(f.events.published().at(-1)).toMatchObject({ type: 'shot.status', status: 'draft' })
  })

  it('まだ残っていれば採用待ちのまま', async () => {
    const f = build()

    const json = (await (await f.hide(f.first)).json()) as Ok<HideData>

    expect(json.data.shot.status).toBe('review')
  })

  it('生成中の Shot の状態は変えない（生成が終われば worker が決める）', async () => {
    const f = build({ status: 'generating' })

    const json = (await (await f.hide(f.first)).json()) as Ok<HideData>

    expect(json.data.shot.status).toBe('generating')
  })

  it('もう見えない・無い Take は 404', async () => {
    const f = build()
    await f.hide(f.first)

    expect((await f.hide(f.first)).status).toBe(404)
  })

  it('見えなくした Take は採用できない', async () => {
    const f = build()
    await f.hide(f.first)

    const res = await f.app.request(`/shots/${f.shot.id}/select-take`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ takeId: f.first.id }),
    })

    expect(res.status).toBe(422)
  })
})
