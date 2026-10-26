import { ProjectId, newId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { closeDbClient, createDbClient } from '../client.js'
import { createProjectClipLock } from '../repositories/project-clip-lock.js'

/**
 * セリフの字幕の作り直しの鍵（ADR-0061）。**実際の Postgres で** `pg_advisory_xact_lock` が同じ作品を 1 本ずつにし、
 * 別の作品は待たせないことを確かめる。表には書かない（鍵だけ）。`DATABASE_URL` が無ければ飛ばす（skipped に出る）。
 */

const url = process.env['DATABASE_URL']

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

type Span = { readonly start: number; readonly end: number }

describe.skipIf(url === undefined)('createProjectClipLock（実際の DB）', () => {
  const run = async (projects: readonly ProjectId[]): Promise<readonly Span[]> => {
    if (url === undefined) throw new Error('DATABASE_URL がありません')
    const db = createDbClient(url, { maxConnections: 4 })
    try {
      const lock = createProjectClipLock(db)
      const t0 = Date.now()
      return await Promise.all(
        projects.map((projectId) =>
          lock(projectId, async () => {
            const start = Date.now() - t0
            await sleep(150)
            return { start, end: Date.now() - t0 }
          }),
        ),
      )
    } finally {
      await closeDbClient(db)
    }
  }

  it('同じ作品は 1 本ずつ（重ならない）', async () => {
    const project = newId(ProjectId)
    const [a, b] = await run([project, project])
    if (a === undefined || b === undefined) throw new Error('2 本あるはず')
    const [first, second] = a.start <= b.start ? [a, b] : [b, a]
    expect(second.start).toBeGreaterThanOrEqual(first.end - 5)
  })

  it('別の作品は待たせない（重なる）', async () => {
    const [a, b] = await run([newId(ProjectId), newId(ProjectId)])
    if (a === undefined || b === undefined) throw new Error('2 本あるはず')
    expect(Math.abs(a.start - b.start)).toBeLessThan(100)
  })
})
