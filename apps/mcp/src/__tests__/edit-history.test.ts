import { describe, expect, it } from 'vitest'
import { listEditsTool, undoTool } from '../tools/edit-history.js'
import { createFakeApi, depsFor, jsonOf, textOf, ulid } from './fake-api.js'

const PROJECT = ulid('PJ1')
const OLD = ulid('EB1')
const NEW = ulid('EB2')
const SHOT = ulid('SH1')

const batch = (id: string, canUndo: boolean, undoneAt: string | null = null) => ({
  id,
  kind: 'shot_patch',
  summary: `直し ${id.slice(-3)}`,
  shotCount: 1,
  undoneAt,
  createdAt: '2026-10-23T00:00:00.000Z',
  canUndo,
})

const listRoute = {
  method: 'GET',
  path: `/projects/${PROJECT}/edit-batches`,
  data: [batch(NEW, false, '2026-10-23T01:00:00.000Z'), batch(OLD, true)],
}

describe('list_edits / undo', () => {
  it('list_edits は新しい順に、取り消せるかを添えて返す', async () => {
    const result = jsonOf(await listEditsTool.run({ projectId: PROJECT, limit: 1 }, depsFor(createFakeApi([listRoute]))))
    expect(result).toEqual({
      edits: [{ editBatchId: NEW, summary: batch(NEW, false).summary, kind: 'shot_patch', createdAt: '2026-10-23T00:00:00.000Z', undoneAt: '2026-10-23T01:00:00.000Z', canUndo: false }],
    })
  })

  it('undo は指定が無ければ取り消せるうち最新を戻し、空の欄は返さない', async () => {
    const fake = createFakeApi([
      listRoute,
      {
        method: 'POST',
        path: `/projects/${PROJECT}/edit-batches/${OLD}/undo`,
        data: { batch: batch(OLD, false), restored: [SHOT], failed: [], restoredClips: [], failedClips: [], restoredProject: false, failedProject: null },
      },
    ])
    const result = jsonOf(await undoTool.run({ projectId: PROJECT }, depsFor(fake)))
    expect(result).toEqual({ editBatchId: OLD, summary: batch(OLD, false).summary, restored: [SHOT] })
  })

  it('取り消せる直しが無ければそう言う', async () => {
    const fake = createFakeApi([{ ...listRoute, data: [batch(NEW, false)] }])
    expect(textOf(await undoTool.run({ projectId: PROJECT }, depsFor(fake)))).toContain('取り消せる直しがありません')
  })
})
