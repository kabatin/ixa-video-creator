import { OpenAPIHono } from '@hono/zod-openapi'
import {
  ProjectId as ProjectIdSchema,
  ScriptId as ScriptIdSchema,
  ScriptVersionId as ScriptVersionIdSchema,
  newId,
} from '@ixa/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { scriptRoutes, type ScriptRoutesDeps } from '../routes/scripts.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import {
  createInMemoryScriptRepository,
  type InMemoryScriptRepository,
} from './in-memory-script-repositories.js'

type SuccessBody<T> = { success: true; data: T }
type ListBody<T> = { success: true; data: T[]; meta: { total: number } }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }

type ScriptBody = { id: string; projectId: string; currentVersionId: string | null }
type VersionBody = {
  id: string
  scriptId: string
  version: number
  content: string
  authoredBy: string
  createdAt: string
}

const project = aProject()
const otherProject = aProject({ name: '別の Project' })

let scripts: InMemoryScriptRepository

const buildApp = (deps: ScriptRoutesDeps) => {
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', scriptRoutes(deps))
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

/** 版を 1 つ追記して結果を返す。 */
const appendVersion = async (
  projectId: string,
  content: string,
  authoredBy: 'human' | 'ai' = 'human',
) => {
  const res = await send('POST', `/projects/${projectId}/script/versions`, { content, authoredBy })
  const bodyJson = await json<SuccessBody<{ script: ScriptBody; version: VersionBody }>>(res)
  return { status: res.status, ...bodyJson.data }
}

beforeEach(() => {
  scripts = createInMemoryScriptRepository()
  app = buildApp({
    scripts,
    projects: createInMemoryProjectRepository([project, otherProject]),
  })
})

describe('版の追記', () => {
  it('Script が無ければ同時に作り、version は 1 から連番で増える', async () => {
    const first = await appendVersion(project.id, '# 第 1 稿')
    expect(first.status).toBe(201)
    expect(first.version.version).toBe(1)
    expect(first.script.projectId).toBe(project.id)

    const second = await appendVersion(project.id, '# 第 2 稿', 'ai')
    expect(second.version.version).toBe(2)
    // Script は作り直されない。同じ 1 本に積まれる。
    expect(second.script.id).toBe(first.script.id)

    const third = await appendVersion(project.id, '# 第 3 稿')
    expect(third.version.version).toBe(3)
    expect(scripts.snapshot()).toHaveLength(1)
  })

  it('既存の版を書き換えない（追記のみ）', async () => {
    const first = await appendVersion(project.id, '# 第 1 稿')
    await appendVersion(project.id, '# 第 2 稿')

    const stored = scripts.versionSnapshot()
    expect(stored).toHaveLength(2)

    const original = stored.find((v) => v.id === first.version.id)
    expect(original?.content).toBe('# 第 1 稿')
    expect(original?.version).toBe(1)
  })

  it('追記した版がそのまま現在の版になる', async () => {
    const first = await appendVersion(project.id, '# 第 1 稿')
    expect(first.script.currentVersionId).toBe(first.version.id)

    const second = await appendVersion(project.id, '# 第 2 稿')
    expect(second.script.currentVersionId).toBe(second.version.id)
  })

  it('存在しない Project には追記できない', async () => {
    const res = await send(`POST`, `/projects/${newId(ProjectIdSchema)}/script/versions`, {
      content: '# 幽霊',
      authoredBy: 'human',
    })
    expect(res.status).toBe(404)
  })

  it('本文が無い要求は 422', async () => {
    const res = await send('POST', `/projects/${project.id}/script/versions`, {
      authoredBy: 'human',
    })
    expect(res.status).toBe(422)
    const body = await json<ErrorBody>(res)
    expect(body.fields?.content).toBeDefined()
  })
})

describe('Script と版の取得', () => {
  it('現在の版を本文つきで返す', async () => {
    await appendVersion(project.id, '# 第 1 稿')
    const latest = await appendVersion(project.id, '# 第 2 稿', 'ai')

    const res = await send('GET', `/projects/${project.id}/script`)
    expect(res.status).toBe(200)
    const body = await json<
      SuccessBody<{ script: ScriptBody; currentVersion: VersionBody | null }>
    >(res)
    expect(body.data.currentVersion?.content).toBe('# 第 2 稿')
    expect(body.data.currentVersion?.id).toBe(latest.version.id)
    expect(body.data.currentVersion?.authoredBy).toBe('ai')
  })

  it('版の一覧は version 降順で返る', async () => {
    await appendVersion(project.id, '# 第 1 稿')
    await appendVersion(project.id, '# 第 2 稿')
    const third = await appendVersion(project.id, '# 第 3 稿')

    const res = await send('GET', `/scripts/${third.script.id}/versions`)
    expect(res.status).toBe(200)
    const body = await json<ListBody<VersionBody>>(res)
    expect(body.data.map((v) => v.version)).toEqual([3, 2, 1])
    expect(body.meta.total).toBe(3)
  })

  it('Script をまだ作っていない Project は 404', async () => {
    const res = await send('GET', `/projects/${project.id}/script`)
    expect(res.status).toBe(404)
  })

  it('存在しない Script の版一覧は 404', async () => {
    const res = await send('GET', `/scripts/${newId(ScriptIdSchema)}/versions`)
    expect(res.status).toBe(404)
  })
})

describe('現在の版の切り替え', () => {
  it('過去の版へ戻せる', async () => {
    const first = await appendVersion(project.id, '# 第 1 稿')
    const second = await appendVersion(project.id, '# 第 2 稿')

    const res = await send('POST', `/scripts/${second.script.id}/current-version`, {
      versionId: first.version.id,
    })
    expect(res.status).toBe(200)
    const body = await json<SuccessBody<ScriptBody>>(res)
    expect(body.data.currentVersionId).toBe(first.version.id)

    const reread = await send('GET', `/projects/${project.id}/script`)
    const current = await json<SuccessBody<{ currentVersion: VersionBody | null }>>(reread)
    expect(current.data.currentVersion?.content).toBe('# 第 1 稿')
  })

  it('他 Project の版を指定したら 422', async () => {
    const mine = await appendVersion(project.id, '# 自分の稿')
    const theirs = await appendVersion(otherProject.id, '# 他人の稿')

    const res = await send('POST', `/scripts/${mine.script.id}/current-version`, {
      versionId: theirs.version.id,
    })
    expect(res.status).toBe(422)
    const body = await json<ErrorBody>(res)
    expect(body.fields?.versionId).toBeDefined()

    // 切り替わっていないことを確かめる。
    expect(scripts.snapshot().find((s) => s.id === mine.script.id)?.currentVersionId).toBe(
      mine.version.id,
    )
  })

  it('存在しない Script は 404、存在しない版は 422', async () => {
    const mine = await appendVersion(project.id, '# 自分の稿')

    const missingScript = await send('POST', `/scripts/${newId(ScriptIdSchema)}/current-version`, {
      versionId: mine.version.id,
    })
    expect(missingScript.status).toBe(404)

    const missingVersion = await send('POST', `/scripts/${mine.script.id}/current-version`, {
      versionId: newId(ScriptVersionIdSchema),
    })
    expect(missingVersion.status).toBe(422)
  })
})
