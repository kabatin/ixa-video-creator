import { aShot, aTake, createInMemoryShotRepository, createInMemoryTakeRepository } from '@ixa/generation/testing'
import type { Shot } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { SHOT_CODE_TAKEN_REASON } from '../routes/edit-batch-shot-undo.js'
import type { EditBatchSummaryResponse, UndoEditBatchResponse } from '../routes/edit-batches.js'
import { baseAppDeps, createTestApp } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * Shot の作成・削除・分割・結合・一括削除を取り消す（2026-10-19 の見直し・段 5）。
 * Shot は論理削除なので、消したものは戻すと**同じ ID・同じ中身**になる。記録は書き込みと同じトランザクション。
 */

type Ok<T> = { success: true; data: T }

const project = aProject()

const build = (shots: readonly Shot[], options: { readonly recordFails?: boolean } = {}) => {
  const repo = createInMemoryShotRepository(shots)
  const takes = createInMemoryTakeRepository()
  const editBatches = createInMemoryEditBatchRepository()
  const recorder =
    options.recordFails === true ? { ...editBatches, create: () => Promise.reject(new Error('記録を作れません')) } : editBatches
  const app = createTestApp({
    ...baseAppDeps(),
    projects: createInMemoryProjectRepository([project]),
    shots: repo,
    takes,
    editBatches: recorder,
  })
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const latest = async (): Promise<EditBatchSummaryResponse | undefined> =>
    ((await (await app.request(`/projects/${project.id}/edit-batches`)).json()) as { data: EditBatchSummaryResponse[] }).data[0]
  const undo = async (id: string): Promise<UndoEditBatchResponse> => {
    const res = await send('POST', `/projects/${project.id}/edit-batches/${id}/undo`)
    expect(res.status).toBe(200)
    return ((await res.json()) as Ok<UndoEditBatchResponse>).data
  }
  const live = () => repo.findByProject(project.id)
  return { repo, takes, editBatches, send, latest, undo, live }
}

const a = aShot(project.id, { code: 'CUT-01', order: 1000, startSec: 0, durationSec: 4 })
const b = aShot(project.id, { code: 'CUT-02', order: 2000, startSec: 4, durationSec: 2 })

/** 作る口の本文（ID・作品・作った時刻など、サーバが決める欄を外した Shot）。 */
const SERVER_FIELDS: ReadonlySet<string> = new Set(['id', 'projectId', 'createdAt', 'updatedAt', 'selectedTakeId', 'lockedAt'])
const createBody = (overrides: Partial<Shot>) =>
  Object.fromEntries(Object.entries(aShot(project.id, overrides)).filter(([key]) => !SERVER_FIELDS.has(key)))

describe('作る・消す', () => {
  it('作ると記録が残り、戻すと消える', async () => {
    const f = build([a])
    const res = await f.send('POST', `/projects/${project.id}/shots`, createBody({ code: 'CUT-09', order: 9000, startSec: 6, durationSec: 2 }))
    expect(res.status).toBe(201)
    const batch = await f.latest()
    expect(batch).toMatchObject({ kind: 'shot_edit', summary: 'CUT-09 を作る', shotCount: 1 })

    await f.undo(batch!.id)
    expect(await f.live()).toEqual([a])
  })

  it('消すと記録が残り、戻すと同じ ID・同じ中身で戻る', async () => {
    const f = build([a, b])
    expect((await f.send('DELETE', `/shots/${b.id}`)).status).toBe(204)
    const batch = await f.latest()
    expect(batch?.summary).toBe('CUT-02 を消す')

    const result = await f.undo(batch!.id)
    expect(result.restored).toEqual([b.id])
    expect((await f.live()).map((shot) => shot.id)).toEqual([a.id, b.id])
    expect(await f.repo.findById(b.id)).toEqual(b)
  })

  it('消した後で同じコードの Shot が作られていたら、理由つきで戻せなかったと返す', async () => {
    const f = build([a, b])
    await f.send('DELETE', `/shots/${b.id}`)
    const removed = await f.latest()
    await f.send('POST', `/projects/${project.id}/shots`, createBody({ code: 'CUT-02', order: 2000, startSec: 4, durationSec: 2 }))

    const result = await f.undo(removed!.id)
    expect(result.failed.map((entry) => entry.shotId)).toEqual([b.id])
    expect(result.failed[0]?.reason).toBe(SHOT_CODE_TAKEN_REASON)
  })

  it('記録が作れなければ作らない・消さない', async () => {
    const f = build([a, b], { recordFails: true })
    expect((await f.send('POST', `/projects/${project.id}/shots`, createBody({ code: 'CUT-09', order: 9000 }))).status).toBe(500)
    expect((await f.send('DELETE', `/shots/${b.id}`)).status).toBe(500)
    expect(await f.live()).toEqual([a, b])
  })
})

describe('分割・結合・一括削除', () => {
  it('分割は 1 つの記録になり、戻すと後半が消え、前半の尺が戻る', async () => {
    const f = build([a])
    expect((await f.send('POST', `/shots/${a.id}/split`, { atSec: 1.5 })).status).toBe(200)
    expect(await f.live()).toHaveLength(2)
    const batch = await f.latest()
    expect(batch).toMatchObject({ summary: 'CUT-01 を分割する', shotCount: 2 })

    await f.undo(batch!.id)
    const [only, ...rest] = await f.live()
    expect(rest).toEqual([])
    expect(only).toMatchObject({ id: a.id, durationSec: 4 })
  })

  it('結合は 1 つの記録になり、戻すと消した Shot が同じ ID で戻り、残した Shot の尺も戻る', async () => {
    const f = build([a, b])
    expect((await f.send('POST', `/projects/${project.id}/shots/merge`, { shotIds: [a.id, b.id] })).status).toBe(200)
    const batch = await f.latest()
    expect(batch).toMatchObject({ summary: 'CUT-01 に 1 件をまとめる', shotCount: 2 })

    await f.undo(batch!.id)
    const live = await f.live()
    expect(live.map((shot) => [shot.id, shot.durationSec])).toEqual([
      [a.id, 4],
      [b.id, 2],
    ])
  })

  it('一括削除は 1 つの記録になり、戻すと全部戻る', async () => {
    const f = build([a, b])
    expect((await f.send('POST', `/projects/${project.id}/shots/bulk/delete`, { shotIds: [a.id, b.id] })).status).toBe(200)
    expect(await f.live()).toEqual([])
    const batch = await f.latest()
    expect(batch).toMatchObject({ summary: 'Shot を 2 件まとめて消す', shotCount: 2 })

    await f.undo(batch!.id)
    expect((await f.live()).map((shot) => shot.id)).toEqual([a.id, b.id])
  })

  it('記録が作れなければ分割・結合・一括削除しない', async () => {
    const f = build([a, b], { recordFails: true })
    expect((await f.send('POST', `/shots/${a.id}/split`, { atSec: 1.5 })).status).toBe(500)
    expect((await f.send('POST', `/projects/${project.id}/shots/merge`, { shotIds: [a.id, b.id] })).status).toBe(500)
    expect((await f.send('POST', `/projects/${project.id}/shots/bulk/delete`, { shotIds: [a.id] })).status).toBe(500)
    expect(await f.live()).toEqual([a, b])
  })
})

/**
 * 段 5 のレビュー（2026-10-19）。戻すと Shot が黙って消える・タイムラインに穴が空く、を起こさない。
 */
describe('戻せない Shot は戻さない', () => {
  it('作った後で Take ができた Shot は、作成を戻さず理由を返す（分割の「Take が無い Shot だけ」と同じ）', async () => {
    const f = build([a])
    const res = await f.send('POST', `/projects/${project.id}/shots`, createBody({ code: 'CUT-09', order: 9000, startSec: 6, durationSec: 2 }))
    const made = ((await res.json()) as Ok<Shot>).data
    const batch = await f.latest()
    await f.takes.create(aTake({ ...a, id: made.id }, 'a'.repeat(64)))

    const result = await f.undo(batch!.id)
    expect(result.failed.map((entry) => entry.shotId)).toEqual([made.id])
    expect((await f.live()).map((shot) => shot.id)).toContain(made.id)
  })

  it('生成中・ロック中の Shot も、作成を戻さない', async () => {
    const f = build([a])
    const res = await f.send('POST', `/projects/${project.id}/shots`, createBody({ code: 'CUT-09', order: 9000, startSec: 6, durationSec: 2 }))
    const made = ((await res.json()) as Ok<Shot>).data
    const batch = await f.latest()
    await f.repo.updateStatus(made.id, 'generating')

    const result = await f.undo(batch!.id)
    expect(result.failed.map((entry) => entry.shotId)).toEqual([made.id])

    const g = build([a])
    const res2 = await g.send('POST', `/projects/${project.id}/shots`, createBody({ code: 'CUT-09', order: 9000, startSec: 6, durationSec: 2 }))
    const locked = ((await res2.json()) as Ok<Shot>).data
    const batch2 = await g.latest()
    await g.repo.update(locked.id, { lockedAt: new Date() })
    expect((await g.undo(batch2!.id)).failed.map((entry) => entry.shotId)).toEqual([locked.id])
  })

  it('結合を戻すとき、消した Shot を戻せなければ残した Shot の尺も戻さない（穴を空けない）', async () => {
    const f = build([a, b])
    await f.send('POST', `/projects/${project.id}/shots/merge`, { shotIds: [a.id, b.id] })
    const merged = await f.latest()
    await f.send('POST', `/projects/${project.id}/shots`, createBody({ code: 'CUT-02', order: 5000, startSec: 6, durationSec: 2 }))

    const result = await f.undo(merged!.id)
    expect(result.failed.map((entry) => entry.shotId).sort()).toEqual([a.id, b.id].sort())
    expect((await f.repo.findById(a.id))?.durationSec).toBe(6)
  })
})
