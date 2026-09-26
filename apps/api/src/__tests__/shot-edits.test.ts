import { OpenAPIHono } from '@hono/zod-openapi'
import {
  CharacterId as CharacterIdSchema,
  CharacterLookId as CharacterLookIdSchema,
  newId,
  type Project,
  type Shot,
} from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryShotCharacterRepository,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { shotEditRoutes } from '../routes/shot-edits.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * Shot の分割と結合（制作者の要望 2026-09-26 / ADR-0024）。規則そのものは domain の
 * `planSplit` / `planMerge` が持ち、ここは「実際に書く」ことと、Take の件数での確認を見る。
 */

type Ok<T> = { success: true; data: T }
type Err = { success: false; error: string; fields?: Record<string, string[]> }
type WireShot = { id: string; code: string; startSec: number; durationSec: number; order: number; locationId: string | null }

const post = (app: OpenAPIHono, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const build = (project: Project, shots: readonly Shot[], options: { takes?: Parameters<typeof createInMemoryTakeRepository>[0] } = {}) => {
  const deps = {
    shots: createInMemoryShotRepository(shots),
    projects: createInMemoryProjectRepository([project]),
    takes: createInMemoryTakeRepository(options.takes ?? []),
    shotCharacters: createInMemoryShotCharacterRepository(),
  }
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route('/', shotEditRoutes(deps))
  return { app, ...deps }
}

const cuts = (project: Project): readonly Shot[] => [
  aShot(project.id, { code: 'CUT-01', order: 1000, startSec: 0, durationSec: 4 }),
  aShot(project.id, { code: 'CUT-02', order: 2000, startSec: 4, durationSec: 6, mood: '夜', description: '店先' }),
  aShot(project.id, { code: 'CUT-03', order: 3000, startSec: 10, durationSec: 5 }),
]

describe('POST /shots/:id/split', () => {
  it('位置で前後に割り、後半は元の演出を引き継いで元の直後に並ぶ', async () => {
    const project = aProject()
    const shots = cuts(project)
    const f = build(project, shots)
    const target = shots[1] as Shot

    const res = await post(f.app, `/shots/${target.id}/split`, { atSec: 7 })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Ok<{ first: WireShot; second: WireShot }>
    expect(body.data.first).toMatchObject({ id: target.id, startSec: 4, durationSec: 3 })
    expect(body.data.second).toMatchObject({ code: 'CUT-02B', startSec: 7, durationSec: 3 })
    const all = (await f.shots.findByProject(project.id)).sort((a, b) => a.order - b.order)
    expect(all.map((s) => s.code)).toEqual(['CUT-01', 'CUT-02', 'CUT-02B', 'CUT-03'])
    const second = all[2] as Shot
    expect(second.mood).toBe('夜')
    expect(second.description).toBe('店先')
  })

  it('登場人物を後半にも引き継ぐ', async () => {
    const project = aProject()
    const shots = cuts(project)
    const f = build(project, shots)
    const target = shots[1] as Shot
    const characterId = newId(CharacterIdSchema)
    await f.shotCharacters.add({ shotId: target.id, characterId, lookId: newId(CharacterLookIdSchema), prominence: 'primary', order: 0 })

    const res = await post(f.app, `/shots/${target.id}/split`, { atSec: 7 })
    const body = (await res.json()) as Ok<{ second: WireShot }>

    const cast = await f.shotCharacters.findByShot(body.data.second.id as Shot['id'])
    expect(cast.map((c) => c.characterId)).toEqual([characterId])
  })

  it('Take が 1 本でもあれば割らない（状態が下書きでも件数で確かめる）', async () => {
    const project = aProject()
    const shots = cuts(project)
    const target = shots[1] as Shot
    const f = build(project, shots, { takes: [aTake(target, 'a'.repeat(64))] })

    const res = await post(f.app, `/shots/${target.id}/split`, { atSec: 7 })

    expect(res.status).toBe(422)
    const body = (await res.json()) as Err
    expect(body.fields?.atSec?.[0]).toContain('Take')
    expect(await f.shots.findByProject(project.id)).toHaveLength(3)
  })

  it('範囲外の位置は 422 で理由を返す', async () => {
    const project = aProject()
    const shots = cuts(project)
    const f = build(project, shots)

    const res = await post(f.app, `/shots/${(shots[1] as Shot).id}/split`, { atSec: 12 })

    expect(res.status).toBe(422)
    expect(((await res.json()) as Err).fields?.atSec?.[0]).toContain('範囲')
  })

  it('並び順に隙間が無くても、元の直後に入る（並べ直す）', async () => {
    const project = aProject()
    const tight = [
      aShot(project.id, { code: 'A', order: 1000, startSec: 0, durationSec: 4 }),
      aShot(project.id, { code: 'B', order: 1001, startSec: 4, durationSec: 4 }),
    ]
    const f = build(project, tight)

    await post(f.app, `/shots/${(tight[0] as Shot).id}/split`, { atSec: 2 })

    const all = (await f.shots.findByProject(project.id)).sort((a, b) => a.order - b.order)
    expect(all.map((s) => s.code)).toEqual(['A', 'AB', 'B'])
  })
})

describe('POST /projects/:projectId/shots/merge', () => {
  it('隣り合う Shot を先頭にまとめ、残りを消す', async () => {
    const project = aProject()
    const shots = cuts(project)
    const f = build(project, shots)

    const res = await post(f.app, `/projects/${project.id}/shots/merge`, {
      shotIds: [(shots[1] as Shot).id, (shots[0] as Shot).id],
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Ok<{ shot: WireShot; removedShotIds: string[] }>
    expect(body.data.shot).toMatchObject({ code: 'CUT-01', startSec: 0, durationSec: 10 })
    expect(body.data.removedShotIds).toEqual([(shots[1] as Shot).id])
    expect((await f.shots.findByProject(project.id)).map((s) => s.code).sort()).toEqual(['CUT-01', 'CUT-03'])
  })

  it('隣り合っていなければ 422 で何も変えない', async () => {
    const project = aProject()
    const shots = cuts(project)
    const f = build(project, shots)

    const res = await post(f.app, `/projects/${project.id}/shots/merge`, {
      shotIds: [(shots[0] as Shot).id, (shots[2] as Shot).id],
    })

    expect(res.status).toBe(422)
    expect(((await res.json()) as Err).fields?.shotIds?.[0]).toContain('隣り合って')
    expect(await f.shots.findByProject(project.id)).toHaveLength(3)
  })

  it('Take がある Shot を含めば 422', async () => {
    const project = aProject()
    const shots = cuts(project)
    const f = build(project, shots, { takes: [aTake(shots[1] as Shot, 'a'.repeat(64))] })

    const res = await post(f.app, `/projects/${project.id}/shots/merge`, {
      shotIds: [(shots[0] as Shot).id, (shots[1] as Shot).id],
    })

    expect(res.status).toBe(422)
    expect(((await res.json()) as Err).fields?.shotIds?.[0]).toContain('CUT-02')
  })

  it('別の Project の Shot を混ぜたら 422', async () => {
    const project = aProject()
    const other = aProject()
    const shots = cuts(project)
    const foreign = aShot(other.id, { code: 'X', startSec: 4, durationSec: 2 })
    const f = build(project, [...shots, foreign])

    const res = await post(f.app, `/projects/${project.id}/shots/merge`, {
      shotIds: [(shots[0] as Shot).id, foreign.id],
    })

    expect(res.status).toBe(422)
  })
})
