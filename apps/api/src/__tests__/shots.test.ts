import {
  LocationId as LocationIdSchema,
  ShotId as ShotIdSchema,
  TakeId as TakeIdSchema,
  newId,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { type ShotResponse } from '../routes/shots.js'
import { baseAppDeps } from './app-deps.js'
import { aProject } from './fixtures.js'
import { aShot, aTake, createInMemoryShotRepository, createInMemoryTakeRepository } from '@ixa/generation/testing'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { buildFixture, postJson, type ErrorBody, type Ok } from './shot-test-support.js'

describe('POST /shots/:id/select-take', () => {
  it('当該 Shot の Take なら selectedTakeId と status を更新する', async () => {
    const f = buildFixture()
    const take = await f.takes.create({
      shotId: f.shot.id,
      mediaAssetId: aTake(f.shot, 'a'.repeat(64)).mediaAssetId,
      spec: aTake(f.shot, 'a'.repeat(64)).spec,
      specHash: 'a'.repeat(64),
      providerId: aTake(f.shot, 'a'.repeat(64)).providerId,
      modelId: aTake(f.shot, 'a'.repeat(64)).modelId,
      providerParams: { kind: 'http', request: {} },
      seedUsed: null,
      costUsd: 0.4,
      generationTimeSec: 10,
      parentTakeId: null,
      regenerationReason: null,
    })

    const res = await postJson(f.app, `/shots/${f.shot.id}/select-take`, { takeId: take.id })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<ShotResponse>
    expect(json.data.selectedTakeId).toBe(take.id)
    // **採用が決定。** 人の承認を別に待たない（ADR-0023）。以前は humanVerdict が
    // approved でない限り 'review' のままで、採用しても状態列が「レビュー待ち」から動かなかった。
    expect(json.data.status).toBe('approved')
  })

  it('他 Shot の Take を指定したら 422 で Shot を変更しない', async () => {
    const f = buildFixture()
    const otherShot = aShot(f.project.id, { code: 'shot_002', order: 2000 })
    const foreign = aTake(otherShot, 'b'.repeat(64))
    const takes = createInMemoryTakeRepository([foreign])

    const app = createApp({
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository([f.project]),
      shots: f.shots,
      takes,
    })

    const res = await postJson(app, `/shots/${f.shot.id}/select-take`, { takeId: foreign.id })

    expect(res.status).toBe(422)
    expect(Object.keys(((await res.json()) as ErrorBody).fields ?? {})).toContain('takeId')
    expect(f.shots.snapshot()[0]?.selectedTakeId).toBeNull()
  })

  it('存在しない Take を指定したら 422', async () => {
    const f = buildFixture()
    const res = await postJson(f.app, `/shots/${f.shot.id}/select-take`, {
      takeId: newId(TakeIdSchema),
    })
    expect(res.status).toBe(422)
  })
})

describe('DELETE /shots/:id/selected-take（PHASE 8）', () => {
  const adopt = async (f: ReturnType<typeof buildFixture>) => {
    const take = await f.takes.create({
      shotId: f.shot.id,
      mediaAssetId: aTake(f.shot, 'c'.repeat(64)).mediaAssetId,
      spec: aTake(f.shot, 'c'.repeat(64)).spec,
      specHash: 'c'.repeat(64),
      providerId: aTake(f.shot, 'c'.repeat(64)).providerId,
      modelId: aTake(f.shot, 'c'.repeat(64)).modelId,
      providerParams: { kind: 'http', request: {} },
      seedUsed: null,
      costUsd: 0,
      generationTimeSec: 1,
      parentTakeId: null,
      regenerationReason: null,
    })
    await postJson(f.app, `/shots/${f.shot.id}/select-take`, { takeId: take.id })
    return take
  }

  it('採用を外し、Take は消さず、状態を review に戻す', async () => {
    const f = buildFixture()
    const take = await adopt(f)

    const res = await f.app.request(`/shots/${f.shot.id}/selected-take`, { method: 'DELETE' })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<ShotResponse>
    expect(json.data.selectedTakeId).toBeNull()
    expect(json.data.status).toBe('review')
    expect(await f.takes.findById(take.id)).not.toBeNull()
  })

  it('採用が無い Shot でも 200 で何も変えない', async () => {
    const f = buildFixture()
    const res = await f.app.request(`/shots/${f.shot.id}/selected-take`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as Ok<ShotResponse>).data.selectedTakeId).toBeNull()
  })

  it('存在しない Shot は 404', async () => {
    const f = buildFixture()
    const res = await f.app.request(`/shots/${newId(ShotIdSchema)}/selected-take`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })
})

describe('Shot CRUD', () => {
  it('一覧は order 昇順', async () => {
    const project = aProject()
    const shots = createInMemoryShotRepository([
      aShot(project.id, { order: 3000, code: 'shot_003' }),
      aShot(project.id, { order: 1000, code: 'shot_001' }),
      aShot(project.id, { order: 2000, code: 'shot_002' }),
    ])
    const app = createApp({
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository([project]),
      shots,
    })

    const res = await app.request(`/projects/${project.id}/shots`)
    expect(res.status).toBe(200)

    const json = (await res.json()) as { data: ShotResponse[] }
    expect(json.data.map((s) => s.code)).toEqual(['shot_001', 'shot_002', 'shot_003'])
  })

  it('作成は 201、削除は 204 でその後 404 になる', async () => {
    const f = buildFixture()

    const created = await postJson(f.app, `/projects/${f.project.id}/shots`, {
      sequenceId: null,
      order: 1000,
      code: 'shot_010',
      startSec: 0,
      durationSec: 3.75,
      camera: f.shot.camera,
      dialogue: null,
      mood: null,
      sourceType: { type: 'ai_video' },
    })
    expect(created.status).toBe(201)

    const id = ((await created.json()) as Ok<ShotResponse>).data.id
    expect((await f.app.request(`/shots/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await f.app.request(`/shots/${id}/takes`)).status).toBe(404)
  })

  it('PATCH は編集尺とトリム位置を更新できる', async () => {
    const f = buildFixture()

    const res = await f.app.request(`/shots/${f.shot.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ durationSec: 7.5, sourceInSec: 0.15 }),
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<ShotResponse>
    expect(json.data.durationSec).toBe(7.5)
    expect(json.data.sourceInSec).toBe(0.15)
    expect(json.data.description).toBe(f.shot.description)
  })

  /** Take を尺に合わせる（ADR-0026）。既定は trim。 */
  it('PATCH で Take の合わせ方（timing）を変えられる', async () => {
    const f = buildFixture()

    const res = await f.app.request(`/shots/${f.shot.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timing: 'fit' }),
    })

    expect(res.status).toBe(200)
    expect(((await res.json()) as Ok<ShotResponse>).data.timing).toBe('fit')
  })

  it('PATCH でロケーションを付け外しできる（ADR-0015）', async () => {
    const f = buildFixture()
    const locationId = newId(LocationIdSchema)

    const patch = (body: unknown) =>
      f.app.request(`/shots/${f.shot.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    const assigned = (await (await patch({ locationId })).json()) as Ok<ShotResponse>
    expect(assigned.data.locationId).toBe(locationId)

    // null を送れば外せる。未指定との区別がつかないと場所を消せなくなる。
    const cleared = (await (await patch({ locationId: null })).json()) as Ok<ShotResponse>
    expect(cleared.data.locationId).toBeNull()
  })
})

describe('GET /shots/:id/takes', () => {
  it('index 昇順で返す', async () => {
    const f = buildFixture()
    const one = aTake(f.shot, 'c'.repeat(64), { index: 1 })
    const two = aTake(f.shot, 'd'.repeat(64), { index: 2 })
    const app = createApp({
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository([f.project]),
      shots: f.shots,
      takes: createInMemoryTakeRepository([two, one]),
    })

    const res = await app.request(`/shots/${f.shot.id}/takes`)
    expect(res.status).toBe(200)

    const json = (await res.json()) as { data: { id: string; index: number }[] }
    expect(json.data.map((t) => t.index)).toEqual([1, 2])
  })
})

describe('Take の追記のみ制約（ADR-0003）', () => {
  it('updateReview は reviewStatus / humanVerdict 以外を受け付けない', async () => {
    const f = buildFixture()
    const original = aTake(f.shot, 'e'.repeat(64))
    const takes = createInMemoryTakeRepository([original])

    const updated = await takes.updateReview(original.id, {
      reviewStatus: 'passed',
      humanVerdict: 'approved',
      // 以下は TakeUpdate に無いため strip される
      costUsd: 999,
      specHash: 'f'.repeat(64),
      mediaAssetId: newId(TakeIdSchema),
    } as never)

    expect(updated.reviewStatus).toBe('passed')
    expect(updated.humanVerdict).toBe('approved')
    expect(updated.costUsd).toBe(original.costUsd)
    expect(updated.specHash).toBe(original.specHash)
    expect(updated.mediaAssetId).toBe(original.mediaAssetId)
  })
})

describe('GET /shots/:id', () => {
  it('Shot を 1 件返す', async () => {
    const f = buildFixture()
    const res = await f.app.request(`/shots/${f.shot.id}`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<{ id: string; code: string }>
    expect(json.data.id).toBe(f.shot.id)
    expect(json.data.code).toBe(f.shot.code)
  })

  it('存在しない id は 404', async () => {
    const f = buildFixture()
    const res = await f.app.request('/shots/01ARZ3NDEKTSV4RRFFQ69G5FZZ')
    expect(res.status).toBe(404)
  })
})
