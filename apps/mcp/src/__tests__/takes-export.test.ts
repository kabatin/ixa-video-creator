import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UPSCALE_REASON } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { exportTool } from '../tools/export.js'
import { adoptTakeTool, generateTakesTool, listTakesTool, upscaleTakesTool } from '../tools/takes.js'
import { createFakeApi, depsFor, jsonOf, takeRow, textOf, ulid } from './fake-api.js'

const PROJECT = ulid('PJ1')
const SHOT = ulid('SH1')
const SHOT_B = ulid('SB1')
const TAKE = ulid('TK1')
const TAKE_2 = ulid('TK2')
const MODEL = 'vpipe/minimax-h3-turbo'

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
    expect(fake.calls[0]?.body).toEqual({ shotIds: [SHOT, SHOT_B], model: MODEL, count: 2 })
    expect(result).toMatchObject({
      jobs: [{ kind: 'generation', id: ulid('JB1') }, { kind: 'generation', id: ulid('JB2') }],
      results: [expect.anything(), { shotId: SHOT_B, ok: false, reason: '最初のコマがありません' }],
    })
  })

  it('直しの指示・seed・親 Take があれば Shot ごとの口へ', async () => {
    const fake = createFakeApi([
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
    expect(fake.calls[0]?.body).toEqual({ model: MODEL, count: 1, corrections: ['顔を崩さない'], seed: 3, parentTakeId: TAKE, regenerationReason: '顔' })
    expect(result).toMatchObject({ jobs: [{ kind: 'generation', id: ulid('JB3') }] })
  })

  /** ADR-0057。夜間に自走させるときだけ「NG なら自動で作り直す」を付ける。付けたら Shot ごとの口で頼む。 */
  it('autoRetake を付ければ Shot ごとの口へ autoRetake: true で頼む（付けなければ送らない）', async () => {
    const started = { jobIds: [ulid('JB4')], specHash: 'x'.repeat(64), resolvedModel: MODEL, duplicateOfTakeId: null, stretchedToFit: false }
    const fake = createFakeApi([
      { method: 'POST', path: `/shots/${SHOT}/generate`, status: 202, data: started },
      { method: 'POST', path: `/shots/${SHOT_B}/generate`, status: 202, data: started },
    ])
    await generateTakesTool.run({ projectId: PROJECT, shotIds: [SHOT, SHOT_B], model: MODEL, autoRetake: true }, depsFor(fake))
    expect(fake.calls.map((call) => call.body)).toEqual([
      { model: MODEL, count: 1, autoRetake: true },
      { model: MODEL, count: 1, autoRetake: true },
    ])
  })

  it('親 Take は Shot が 1 つのときだけ', async () => {
    const result = await generateTakesTool.run({ projectId: PROJECT, shotIds: [SHOT, SHOT_B], model: MODEL, parentTakeId: TAKE }, depsFor(createFakeApi([])))
    expect(textOf(result)).toContain('parentTakeId')
  })
})

describe('list_takes / adopt_take / upscale_takes', () => {
  it('list_takes は採用中と解像度を上げたものを印して並べる', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/shots/${SHOT}`, data: shotRow(SHOT, TAKE) },
      { method: 'GET', path: `/shots/${SHOT}/takes`, data: [{ ...takeRow(TAKE_2, TAKE, UPSCALE_REASON), index: 2 }, { ...takeRow(TAKE, null, null), index: 1 }] },
    ])
    const result = jsonOf(await listTakesTool.run({ shotId: SHOT }, depsFor(fake))) as { takes: Record<string, unknown>[] }
    expect(result.takes.map((t) => [t.id, t.selected, t.upscaled])).toEqual([
      [TAKE, true, false],
      [TAKE_2, false, true],
    ])
  })

  it('adopt_take は 1 本なら select-take、まとめてなら rule つきの一括', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/shots/${SHOT}/select-take`, data: { ...shotRow(SHOT, TAKE), projectId: PROJECT } },
      { method: 'POST', path: `/projects/${PROJECT}/shots/bulk/select-take`, data: { results: [{ shotId: SHOT, ok: true, takeId: TAKE, status: 'review' }] } },
    ])
    const deps = depsFor(fake)
    expect(jsonOf(await adoptTakeTool.run({ shotId: SHOT, takeId: TAKE }, deps))).toMatchObject({ selectedTakeId: TAKE })
    await adoptTakeTool.run({ projectId: PROJECT, shotIds: [SHOT] }, deps)
    expect(fake.calls.map((c) => c.body)).toEqual([{ takeId: TAKE }, { shotIds: [SHOT], rule: 'latest' }])
    expect(textOf(await adoptTakeTool.run({ shotId: SHOT }, deps))).toContain('どちらか')
  })

  it('upscale_takes（一括）は元にした採用中の Take を待つ手がかりにする', async () => {
    const fake = createFakeApi([
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

  it('409 以外の失敗はそのまま返す', async () => {
    const fake = createFakeApi([{ method: 'POST', path: `/projects/${PROJECT}/render`, status: 404, data: 'プロジェクトがありません' }])
    const result = await exportTool.run({ projectId: PROJECT }, depsFor(fake))
    expect(textOf(result)).toContain('404')
  })
})
