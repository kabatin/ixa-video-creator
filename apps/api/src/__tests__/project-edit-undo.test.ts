import { describe, expect, it } from 'vitest'
import type { EditBatchSummaryResponse, UndoEditBatchResponse } from '../routes/edit-batches.js'
import { baseAppDeps, createTestApp } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * 作品の方針・歌詞・歌詞の時刻の直しを取り消す（2026-10-19 の見直し・段 5）。
 * 変えた欄の、変える前の値だけを控え、書き込みと同じトランザクションで記録する。
 */

type Ok<T> = { success: true; data: T }

const build = (options: { readonly recordFails?: boolean } = {}) => {
  const project = { ...aProject(), styleGuide: '水彩', avoid: '', lyrics: '一行目\n二行目', lyricCues: [1] }
  const projects = createInMemoryProjectRepository([project])
  const editBatches = createInMemoryEditBatchRepository()
  const recorder =
    options.recordFails === true ? { ...editBatches, create: () => Promise.reject(new Error('記録を作れません')) } : editBatches
  const app = createTestApp({ ...baseAppDeps(), projects, editBatches: recorder })
  const patch = (body: unknown) =>
    app.request(`/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const latest = async (): Promise<EditBatchSummaryResponse | undefined> =>
    ((await (await app.request(`/projects/${project.id}/edit-batches`)).json()) as { data: EditBatchSummaryResponse[] }).data[0]
  const undo = async (id: string): Promise<UndoEditBatchResponse> => {
    const res = await app.request(`/projects/${project.id}/edit-batches/${id}/undo`, { method: 'POST' })
    expect(res.status).toBe(200)
    return ((await res.json()) as Ok<UndoEditBatchResponse>).data
  }
  return { project, projects, patch, latest, undo }
}

describe('作品の直し', () => {
  it('方針を直すと記録が残り、戻すと変えた欄だけが戻る（その後に直した別の欄は残る）', async () => {
    const f = build()
    expect((await f.patch({ styleGuide: '油彩' })).status).toBe(200)
    const batch = await f.latest()
    expect(batch).toMatchObject({ kind: 'project_edit', summary: '作品の方針を直す', canUndo: true })
    await f.patch({ avoid: '文字' })

    const result = await f.undo(batch!.id)
    expect(result.restoredProject).toBe(true)
    expect(await f.projects.findById(f.project.id)).toMatchObject({ styleGuide: '水彩', avoid: '文字' })
  })

  it('歌詞の時刻を直すと「歌詞の時刻を直す」、戻すと前の時刻に戻る', async () => {
    const f = build()
    await f.patch({ lyricCues: [1, 2.5] })
    const batch = await f.latest()
    expect(batch?.summary).toBe('歌詞の時刻を直す')
    await f.undo(batch!.id)
    expect((await f.projects.findById(f.project.id))?.lyricCues).toEqual([1])
  })

  it('歌詞を直すと「歌詞を直す」、戻すと歌詞も時刻も戻る', async () => {
    const f = build()
    await f.patch({ lyrics: '一行目' })
    const batch = await f.latest()
    expect(batch?.summary).toBe('歌詞を直す')
    await f.undo(batch!.id)
    expect(await f.projects.findById(f.project.id)).toMatchObject({ lyrics: '一行目\n二行目', lyricCues: [1] })
  })

  it('何も変わらない直しは記録しない', async () => {
    const f = build()
    await f.patch({ styleGuide: '水彩' })
    expect(await f.latest()).toBeUndefined()
  })

  it('記録が作れなければ直さない', async () => {
    const f = build({ recordFails: true })
    expect((await f.patch({ styleGuide: '油彩' })).status).toBe(500)
    expect((await f.projects.findById(f.project.id))?.styleGuide).toBe('水彩')
  })
})
