import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UPSCALE_REASON } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { exportTool } from '../tools/export.js'
import { adoptTakeTool, generateTakesTool, hideTakesTool, listTakesTool, upscaleTakesTool } from '../tools/takes.js'
import { createFakeApi, depsFor, jsonOf, ownedShots, takeRow, textOf, ulid, type Route } from './fake-api.js'

const PROJECT = ulid('PJ1')
const SHOT = ulid('SH1')
const SHOT_B = ulid('SB1')
const TAKE = ulid('TK1')
const TAKE_2 = ulid('TK2')
const MODEL = 'vpipe/minimax-h3-turbo'
const OTHER_SHOT = ulid('SX1')
const OTHER_TAKE = ulid('TX1')
/** 作品の Shot は SHOT と SHOT_B。SHOT の Take は TAKE と TAKE_2。 */
const owned = ownedShots(PROJECT, [SHOT, SHOT_B])
const takesOfShot: Route = { method: 'GET', path: `/shots/${SHOT}/takes`, data: [takeRow(TAKE, null, null), takeRow(TAKE_2, TAKE, null)] }
const writes = (fake: ReturnType<typeof createFakeApi>) => fake.calls.filter((c) => c.method !== 'GET')

const shotRow = (id: string, selectedTakeId: string | null) => ({
  id,
  order: 0,
  code: 'CUT1',
  startSec: 0,
  durationSec: 5,
  mood: null,
  camera: { size: 'wide', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null },
  locationId: null,
  selectedTakeId,
  status: 'review',
})

describe('generate_takes', () => {
  it('素の依頼は一括の口へ、jobs を wait の形で返す', async () => {
    const fake = createFakeApi([
      owned,
      {
        method: 'POST',
        path: `/projects/${PROJECT}/shots/bulk/generate`,
        status: 202,
        data: {
          results: [
            { shotId: SHOT, ok: true, jobIds: [ulid('JB1'), ulid('JB2')], resolvedModel: MODEL },
            { shotId: SHOT_B, ok: false, reason: '最初のコマがありません' },
          ],
          estimatedTotalUsd: 0,
          enqueuedCount: 2,
        },
      },
    ])
    const result = jsonOf(await generateTakesTool.run({ projectId: PROJECT, shotIds: [SHOT, SHOT_B], model: MODEL, count: 2 }, depsFor(fake)))
    expect(writes(fake)[0]?.body).toEqual({ shotIds: [SHOT, SHOT_B], model: MODEL, count: 2 })
    expect(result).toMatchObject({
      jobs: [{ kind: 'generation', id: ulid('JB1') }, { kind: 'generation', id: ulid('JB2') }],
      results: [expect.anything(), { shotId: SHOT_B, ok: false, reason: '最初のコマがありません' }],
    })
  })

  it('直しの指示・seed・親 Take があれば Shot ごとの口へ', async () => {
    const fake = createFakeApi([
      owned,
      takesOfShot,
      {
        method: 'POST',
        path: `/shots/${SHOT}/generate`,
        status: 202,
        data: { jobIds: [ulid('JB3')], specHash: 'x'.repeat(64), resolvedModel: MODEL, duplicateOfTakeId: null, stretchedToFit: false },
      },
    ])
    const result = jsonOf(
      await generateTakesTool.run(
        { projectId: PROJECT, shotIds: [SHOT], model: MODEL, corrections: ['顔を崩さない'], seed: 3, parentTakeId: TAKE, regenerationReason: '顔' },
        depsFor(fake),
      ),
    )
    expect(writes(fake)[0]?.body).toEqual({ model: MODEL, count: 1, corrections: ['顔を崩さない'], seed: 3, parentTakeId: TAKE, regenerationReason: '顔' })
    expect(result).toMatchObject({ jobs: [{ kind: 'generation', id: ulid('JB3') }] })
  })

  /** ADR-0057。夜間に自走させるときだけ「NG なら自動で作り直す」を付ける。付けたら Shot ごとの口で頼む。 */
  it('autoRetake を付ければ Shot ごとの口へ autoRetake: true で頼む（付けなければ送らない）', async () => {
    const started = { jobIds: [ulid('JB4')], specHash: 'x'.repeat(64), resolvedModel: MODEL, duplicateOfTakeId: null, stretchedToFit: false }
    const fake = createFakeApi([
      owned,
      { method: 'POST', path: `/shots/${SHOT}/generate`, status: 202, data: started },
      { method: 'POST', path: `/shots/${SHOT_B}/generate`, status: 202, data: started },
    ])
    await generateTakesTool.run({ projectId: PROJECT, shotIds: [SHOT, SHOT_B], model: MODEL, autoRetake: true }, depsFor(fake))
    expect(writes(fake).map((call) => call.body)).toEqual([
      { model: MODEL, count: 1, autoRetake: true },
      { model: MODEL, count: 1, autoRetake: true },
    ])
  })

  it('親 Take は Shot が 1 つのときだけ', async () => {
    const result = await generateTakesTool.run({ projectId: PROJECT, shotIds: [SHOT, SHOT_B], model: MODEL, parentTakeId: TAKE }, depsFor(createFakeApi([])))
    expect(textOf(result)).toContain('parentTakeId')
  })

  it('別の作品の Shot・その Shot に無い親 Take なら積まずに断る', async () => {
    const fake = createFakeApi([owned, takesOfShot])
    const deps = depsFor(fake)
    expect(textOf(await generateTakesTool.run({ projectId: PROJECT, shotIds: [SHOT, OTHER_SHOT], model: MODEL }, deps))).toContain(OTHER_SHOT)
    expect(textOf(await generateTakesTool.run({ projectId: PROJECT, shotIds: [OTHER_SHOT], model: MODEL, seed: 1 }, deps))).toContain(OTHER_SHOT)
    expect(
      textOf(await generateTakesTool.run({ projectId: PROJECT, shotIds: [SHOT], model: MODEL, parentTakeId: OTHER_TAKE, regenerationReason: '顔' }, deps)),
    ).toContain(OTHER_TAKE)
    expect(writes(fake)).toHaveLength(0)
  })
})

describe('list_takes / adopt_take / upscale_takes', () => {
  it('list_takes は採用中と解像度を上げたものを印し、includeLastFrame なら最後のコマ（まだなら null）を添えて並べる', async () => {
    const MEDIA_1 = ulid('MD1')
    const MEDIA_2 = ulid('MD2')
    const LAST = ulid('MDF')
    const fake = createFakeApi([
      owned,
      { method: 'GET', path: `/shots/${SHOT}`, data: shotRow(SHOT, TAKE) },
      {
        method: 'GET',
        path: `/shots/${SHOT}/takes`,
        data: [{ ...takeRow(TAKE_2, TAKE, UPSCALE_REASON), index: 2, mediaAssetId: MEDIA_2 }, { ...takeRow(TAKE, null, null), index: 1, mediaAssetId: MEDIA_1 }],
      },
      { method: 'GET', path: `/media/${MEDIA_1}`, data: { id: MEDIA_1, kind: 'video', mimeType: 'video/mp4', lastFrameAssetId: LAST } },
      { method: 'GET', path: `/media/${MEDIA_2}`, data: { id: MEDIA_2, kind: 'video', mimeType: 'video/mp4', lastFrameAssetId: null } },
    ])
    const result = jsonOf(await listTakesTool.run({ projectId: PROJECT, shotId: SHOT, includeLastFrame: true }, depsFor(fake))) as {
      takes: Record<string, unknown>[]
    }
    expect(result.takes.map((t) => [t.id, t.selected, t.upscaled, t.lastFrameAssetId])).toEqual([
      [TAKE, true, false, LAST],
      [TAKE_2, false, true, null],
    ])
  })

  it('list_takes は既定では素材を引かず、最後のコマを返さない', async () => {
    const fake = createFakeApi([owned, { method: 'GET', path: `/shots/${SHOT}`, data: shotRow(SHOT, TAKE) }, takesOfShot])
    const result = jsonOf(await listTakesTool.run({ projectId: PROJECT, shotId: SHOT }, depsFor(fake))) as { takes: Record<string, unknown>[] }
    expect(result.takes).toHaveLength(2)
    expect(result.takes.every((t) => !('lastFrameAssetId' in t))).toBe(true)
    expect(fake.callsTo('GET', /^\/media\//)).toHaveLength(0)
  })

  it('list_takes は別の作品の Shot の Take を返さない', async () => {
    const fake = createFakeApi([owned, { method: 'GET', path: `/shots/${OTHER_SHOT}`, data: shotRow(OTHER_SHOT, null) }])
    expect(textOf(await listTakesTool.run({ projectId: PROJECT, shotId: OTHER_SHOT }, depsFor(fake)))).toContain(OTHER_SHOT)
    expect(fake.callsTo('GET', `/shots/${OTHER_SHOT}/takes`)).toHaveLength(0)
  })

  it('adopt_take の unselect は 1 本なら selected-take を消し、まとめてなら一括で外す（takeId は断る）', async () => {
    const fake = createFakeApi([
      owned,
      { method: 'DELETE', path: `/shots/${SHOT}/selected-take`, data: shotRow(SHOT, null) },
      { method: 'POST', path: `/projects/${PROJECT}/shots/bulk/unselect-take`, data: { results: [{ shotId: SHOT, ok: false, reason: '採用していません' }] } },
    ])
    const deps = depsFor(fake)
    expect(jsonOf(await adoptTakeTool.run({ projectId: PROJECT, shotId: SHOT, unselect: true }, deps))).toEqual({ shotId: SHOT, selectedTakeId: null, status: 'review' })
    expect(jsonOf(await adoptTakeTool.run({ projectId: PROJECT, shotIds: [SHOT], unselect: true }, deps))).toEqual({
      results: [{ shotId: SHOT, ok: false, reason: '採用していません' }],
    })
    expect(writes(fake)[1]?.body).toEqual({ shotIds: [SHOT] })
    expect(textOf(await adoptTakeTool.run({ projectId: PROJECT, shotId: SHOT, takeId: TAKE, unselect: true }, deps))).toContain('takeId')
    expect(writes(fake)).toHaveLength(2)
  })

  it('hide_takes は 1 本ずつ隠し、採用中で断られた分は理由つきで返す', async () => {
    const fake = createFakeApi([
      owned,
      takesOfShot,
      { method: 'DELETE', path: `/takes/${TAKE}`, status: 409, data: '採用中の Take は消せません。先に採用を外してください。' },
      { method: 'DELETE', path: `/takes/${TAKE_2}`, data: { shot: shotRow(SHOT, TAKE) } },
    ])
    const result = jsonOf(await hideTakesTool.run({ projectId: PROJECT, shotId: SHOT, takeIds: [TAKE, TAKE_2] }, depsFor(fake))) as { hidden: number; results: Record<string, unknown>[] }
    expect(result.hidden).toBe(1)
    expect(result.results[0]).toMatchObject({ takeId: TAKE, ok: false })
    expect(String(result.results[0]?.reason)).toContain('採用中')
    expect(result.results[1]).toEqual({ takeId: TAKE_2, ok: true, shotStatus: 'review' })
  })

  it('hide_takes はその Shot に無い Take（別の作品のもの）が混じれば 1 本も隠さない', async () => {
    const fake = createFakeApi([owned, takesOfShot, { method: 'DELETE', path: /^\/takes\//, data: { shot: shotRow(SHOT, null) } }])
    const deps = depsFor(fake)
    expect(textOf(await hideTakesTool.run({ projectId: PROJECT, shotId: SHOT, takeIds: [TAKE, OTHER_TAKE] }, deps))).toContain(OTHER_TAKE)
    expect(textOf(await hideTakesTool.run({ projectId: PROJECT, shotId: OTHER_SHOT, takeIds: [TAKE] }, deps))).toContain(OTHER_SHOT)
    expect(writes(fake)).toHaveLength(0)
  })

  it('adopt_take は 1 本なら select-take、まとめてなら rule つきの一括', async () => {
    const fake = createFakeApi([
      owned,
      takesOfShot,
      { method: 'POST', path: `/shots/${SHOT}/select-take`, data: { ...shotRow(SHOT, TAKE), projectId: PROJECT } },
      { method: 'POST', path: `/projects/${PROJECT}/shots/bulk/select-take`, data: { results: [{ shotId: SHOT, ok: true, takeId: TAKE, status: 'review' }] } },
    ])
    const deps = depsFor(fake)
    expect(jsonOf(await adoptTakeTool.run({ projectId: PROJECT, shotId: SHOT, takeId: TAKE }, deps))).toMatchObject({ selectedTakeId: TAKE })
    await adoptTakeTool.run({ projectId: PROJECT, shotIds: [SHOT] }, deps)
    expect(writes(fake).map((c) => c.body)).toEqual([{ takeId: TAKE }, { shotIds: [SHOT], rule: 'latest' }])
    expect(textOf(await adoptTakeTool.run({ projectId: PROJECT, shotId: SHOT }, deps))).toContain('どちらか')
  })

  it('adopt_take は別の作品の Shot・その Shot に無い Take なら採用を変えずに断る', async () => {
    const fake = createFakeApi([owned, takesOfShot])
    const deps = depsFor(fake)
    expect(textOf(await adoptTakeTool.run({ projectId: PROJECT, shotId: SHOT, takeId: OTHER_TAKE }, deps))).toContain(OTHER_TAKE)
    expect(textOf(await adoptTakeTool.run({ projectId: PROJECT, shotId: OTHER_SHOT, takeId: TAKE }, deps))).toContain(OTHER_SHOT)
    expect(textOf(await adoptTakeTool.run({ projectId: PROJECT, shotIds: [SHOT, OTHER_SHOT] }, deps))).toContain(OTHER_SHOT)
    expect(textOf(await adoptTakeTool.run({ projectId: PROJECT, shotId: OTHER_SHOT, unselect: true }, deps))).toContain(OTHER_SHOT)
    expect(textOf(await adoptTakeTool.run({ projectId: PROJECT, shotIds: [OTHER_SHOT], unselect: true }, deps))).toContain(OTHER_SHOT)
    expect(writes(fake)).toHaveLength(0)
  })

  it('upscale_takes は別の作品の Shot・その Shot に無い Take なら積まずに断る', async () => {
    const fake = createFakeApi([owned, takesOfShot])
    const deps = depsFor(fake)
    expect(textOf(await upscaleTakesTool.run({ projectId: PROJECT, shotId: SHOT, takeId: OTHER_TAKE }, deps))).toContain(OTHER_TAKE)
    expect(textOf(await upscaleTakesTool.run({ projectId: PROJECT, shotIds: [OTHER_SHOT] }, deps))).toContain(OTHER_SHOT)
    expect(writes(fake)).toHaveLength(0)
  })

  it('upscale_takes（一括）は元にした採用中の Take を待つ手がかりにする', async () => {
    const fake = createFakeApi([
      owned,
      {
        method: 'POST',
        path: `/projects/${PROJECT}/shots/bulk/upscale`,
        status: 202,
        data: { results: [{ shotId: SHOT, ok: true, jobId: ulid('UP1') }, { shotId: SHOT_B, ok: false, reason: '採用中の Take がありません' }], enqueuedCount: 1, dryRun: false },
      },
      { method: 'GET', path: `/shots/${SHOT}`, data: shotRow(SHOT, TAKE) },
    ])
    const result = jsonOf(await upscaleTakesTool.run({ projectId: PROJECT, shotIds: [SHOT, SHOT_B] }, depsFor(fake)))
    expect(result).toMatchObject({ enqueuedCount: 1, jobs: [{ kind: 'upscale', shotId: SHOT, takeId: TAKE }] })
  })
})

describe('export', () => {
  const RENDER = ulid('RN1')
  const OUTPUT = ulid('MD5')
  const renderRow = (status: string, outputAssetId: string | null) => ({
    id: RENDER,
    status,
    progress: status === 'succeeded' ? 1 : 0.4,
    outputAssetId,
    error: null,
    preset: 'master_1080p',
    scope: { type: 'full' },
    createdAt: '2026-10-17T03:04:05Z',
  })

  it('書き出しを始め、waitSec の間待ち、出来たら手元のフォルダへ保存する', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ixa-mcp-out-'))
    const fake = createFakeApi([
      { method: 'POST', path: `/projects/${PROJECT}/render`, status: 202, data: { renderJobId: RENDER, warnings: [] } },
      { method: 'GET', path: `/renders/${RENDER}`, sequence: [{ data: renderRow('rendering', null) }, { data: renderRow('succeeded', OUTPUT) }] },
      { method: 'GET', path: `/projects/${PROJECT}`, data: { id: PROJECT, name: 'なつ/うた', fps: 24, resolution: { width: 1920, height: 1080 }, aspectRatio: '16:9', durationSec: 60, status: 'planning' } },
      { method: 'GET', path: `/media/${OUTPUT}/url`, data: { url: '/files/out.mp4?sig=S', expiresInSec: 600 } },
      { method: 'GET', path: '/files/out.mp4', bytes: new Uint8Array([9, 9, 9]) },
    ])
    try {
      const result = jsonOf(await exportTool.run({ projectId: PROJECT, waitSec: 60 }, depsFor(fake, { outputDir: dir }))) as Record<string, string>
      expect(fake.callsTo('POST', `/projects/${PROJECT}/render`)[0]?.body).toEqual({
        preset: 'master_1080p',
        scope: { type: 'full' },
        normalizeLoudness: true,
        force: false,
      })
      expect(result).toMatchObject({ renderJobId: RENDER, status: 'succeeded', outputAssetId: OUTPUT })
      // フォルダの外を指せない名前（`/` を残さない）。
      expect(result.filePath?.startsWith(join(dir, 'なつ_うた', 'なつ_うた '))).toBe(true)
      expect(result.filePath?.endsWith('マスター（1080p）.mp4')).toBe(true)
      expect([...(await readFile(result.filePath ?? ''))]).toEqual([9, 9, 9])
      expect(JSON.stringify(result)).not.toContain('sig=S')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('前回と同じ（409）なら前回の書き出しを使う。待たなければ状態だけ返す', async () => {
    const fake = createFakeApi([
      {
        method: 'POST',
        path: `/projects/${PROJECT}/render`,
        status: 409,
        raw: { success: false, error: '前回と同じです', duplicateOf: { renderJobId: RENDER, finishedAt: null } },
      },
      { method: 'GET', path: `/renders/${RENDER}`, data: renderRow('rendering', null) },
    ])
    const result = jsonOf(await exportTool.run({ projectId: PROJECT }, depsFor(fake)))
    expect(result).toEqual({ renderJobId: RENDER, status: 'rendering', progress: 0.4, reusedPrevious: true })
  })

  it('scope は range をそのまま、shots は最初の頭から最後の終わりまでの区間にして送る', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/projects/${PROJECT}/render`, status: 202, data: { renderJobId: RENDER, warnings: [] } },
      { method: 'GET', path: `/renders/${RENDER}`, data: renderRow('rendering', null) },
      {
        method: 'GET',
        path: `/projects/${PROJECT}/shots`,
        data: [{ ...shotRow(SHOT_B, null), startSec: 7.5, durationSec: 2.25 }, { ...shotRow(SHOT, null), startSec: 3 }],
      },
    ])
    await exportTool.run({ projectId: PROJECT, scope: 'range', startSec: 1, endSec: 4.5 }, depsFor(fake))
    await exportTool.run({ projectId: PROJECT, scope: 'shots', shotIds: [SHOT_B, SHOT] }, depsFor(fake))
    expect(fake.callsTo('POST', `/projects/${PROJECT}/render`).map((c) => (c.body as { scope: unknown }).scope)).toEqual([
      { type: 'range', start: 1, end: 4.5 },
      { type: 'range', start: 3, end: 9.75 },
    ])
  })

  it('scope の欄が足りない・逆さ・作品に無い Shot は書き出す前に断る', async () => {
    const fake = createFakeApi([{ method: 'GET', path: `/projects/${PROJECT}/shots`, data: [shotRow(SHOT, null)] }])
    expect(textOf(await exportTool.run({ projectId: PROJECT, scope: 'range', startSec: 4, endSec: 2 }, depsFor(fake)))).toContain('startSec < endSec')
    expect(textOf(await exportTool.run({ projectId: PROJECT, scope: 'shots' }, depsFor(fake)))).toContain('shotIds')
    expect(textOf(await exportTool.run({ projectId: PROJECT, scope: 'shots', shotIds: [SHOT_B] }, depsFor(fake)))).toContain('この作品に無い')
    expect(fake.callsTo('POST', /.*/)).toHaveLength(0)
  })

  it('別の作品の書き出し（renderJobId）は読まず・落とさずに断る', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}/renders`, data: [{ id: ulid('RN2') }] },
      { method: 'GET', path: `/renders/${RENDER}`, data: renderRow('succeeded', OUTPUT) },
    ])
    expect(textOf(await exportTool.run({ projectId: PROJECT, renderJobId: RENDER }, depsFor(fake)))).toContain(RENDER)
    expect(fake.callsTo('GET', `/renders/${RENDER}`)).toHaveLength(0)
    expect(writes(fake)).toHaveLength(0)
  })

  it('409 以外の失敗はそのまま返す', async () => {
    const fake = createFakeApi([{ method: 'POST', path: `/projects/${PROJECT}/render`, status: 404, data: 'プロジェクトがありません' }])
    const result = await exportTool.run({ projectId: PROJECT }, depsFor(fake))
    expect(textOf(result)).toContain('404')
  })
})
