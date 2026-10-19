import { TextStyleId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { ASSET_NAME_TAKEN_REASON } from '../routes/edit-batch-asset-undo.js'
import type { EditBatchSummaryResponse, UndoEditBatchResponse } from '../routes/edit-batches.js'
import { baseAppDeps, createTestApp } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * テロップのスタイル（保存した見た目）の作る・直す・消すを取り消す（2026-10-19）。
 * スタイルは論理削除なので、消したものは戻すと同じ ID・同じ中身。直したものは変えた欄だけが戻る。
 * 消してもテロップの見た目は残る（当てた値を写している）ので、テロップを付け直す必要は無い。
 */

type Ok<T> = { success: true; data: T }
type Preset = { id: string; name: string; style: Record<string, unknown> }

const project = aProject()

const build = (options: { readonly recordFails?: boolean } = {}) => {
  const editBatches = createInMemoryEditBatchRepository()
  const recorder =
    options.recordFails === true ? { ...editBatches, create: () => Promise.reject(new Error('記録を作れません')) } : editBatches
  const deps = { ...baseAppDeps(), projects: createInMemoryProjectRepository([project]), editBatches: recorder }
  const app = createTestApp(deps)
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const create = async (name: string): Promise<Preset> => {
    const res = await send('POST', `/projects/${project.id}/text-styles`, { name, style: { color: '#FFD100' } })
    expect(res.status).toBe(201)
    return ((await res.json()) as Ok<Preset>).data
  }
  const latest = async (): Promise<EditBatchSummaryResponse | undefined> =>
    ((await (await app.request(`/projects/${project.id}/edit-batches`)).json()) as { data: EditBatchSummaryResponse[] }).data[0]
  const undo = async (id: string): Promise<UndoEditBatchResponse> => {
    const res = await send('POST', `/projects/${project.id}/edit-batches/${id}/undo`)
    expect(res.status).toBe(200)
    return ((await res.json()) as Ok<UndoEditBatchResponse>).data
  }
  const find = (id: string) => deps.textStyles.findById(TextStyleId.parse(id))
  return { deps, send, create, latest, undo, find }
}

describe('テロップのスタイル', () => {
  it('作ると記録が残り、戻すと消える', async () => {
    const f = build()
    const preset = await f.create('歌詞')
    const batch = await f.latest()
    expect(batch).toMatchObject({ kind: 'asset_edit', summary: 'テロップのスタイル「歌詞」を作る', assetCount: 1 })

    const result = await f.undo(batch!.id)
    expect(result.restoredAssets).toEqual([preset.id])
    expect(await f.find(preset.id)).toBeNull()
  })

  it('消すと記録が残り、戻すと同じ ID・同じ中身で戻る', async () => {
    const f = build()
    const preset = await f.create('歌詞')
    const stored = await f.find(preset.id)
    expect((await f.send('DELETE', `/text-styles/${preset.id}`)).status).toBe(204)
    const batch = await f.latest()
    expect(batch?.summary).toBe('テロップのスタイル「歌詞」を消す')

    await f.undo(batch!.id)
    expect(await f.find(preset.id)).toEqual(stored)
  })

  it('直すと変えた欄だけを控え、戻すとその欄だけが戻る', async () => {
    const f = build()
    const preset = await f.create('歌詞')
    await f.send('PATCH', `/text-styles/${preset.id}`, { name: 'サビの歌詞' })
    const renamed = await f.latest()
    expect(renamed?.summary).toBe('テロップのスタイル「歌詞」を直す')
    await f.send('PATCH', `/text-styles/${preset.id}`, { style: { color: '#FFFFFF' } })

    await f.undo(renamed!.id)
    expect(await f.find(preset.id)).toMatchObject({ name: '歌詞', style: { color: '#FFFFFF' } })
  })

  it('何も変わらない直しは記録しない', async () => {
    const f = build()
    const preset = await f.create('歌詞')
    const made = await f.latest()
    await f.send('PATCH', `/text-styles/${preset.id}`, { name: '歌詞' })
    expect((await f.latest())?.id).toBe(made?.id)
  })

  it('消した後で同じ名前のスタイルが作られていたら、理由つきで戻せなかったと返す', async () => {
    const f = build()
    const preset = await f.create('歌詞')
    await f.send('DELETE', `/text-styles/${preset.id}`)
    const removed = await f.latest()
    await f.create('歌詞')

    const result = await f.undo(removed!.id)
    expect(result.failedAssets.map((entry) => entry.assetId)).toEqual([preset.id])
    // 理由は人が読める言葉で（DB の問い合わせの文をそのまま出さない）。
    expect(result.failedAssets[0]?.reason).toBe(ASSET_NAME_TAKEN_REASON)
    expect(await f.find(preset.id)).toBeNull()
  })

  it('記録が作れなければ作らない・消さない', async () => {
    const f = build({ recordFails: true })
    expect((await f.send('POST', `/projects/${project.id}/text-styles`, { name: '歌詞', style: {} })).status).toBe(500)
    expect(await f.deps.textStyles.findByProject(project.id)).toEqual([])
    const kept = await f.deps.textStyles.create(project.id, { name: '残す', style: {} })
    expect((await f.send('DELETE', `/text-styles/${kept.id}`)).status).toBe(500)
    expect(await f.find(kept.id)).toEqual(kept)
  })
})
