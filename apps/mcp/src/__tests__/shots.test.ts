import { describe, expect, it } from 'vitest'
import { createCharacterTool, createLocationTool } from '../tools/cast.js'
import { editShotsTool } from '../tools/edit-shots.js'
import { planShotsTool } from '../tools/plan-shots.js'
import { drawStartFramesTool, setStartFrameTool } from '../tools/start-frames.js'
import { createFakeApi, depsFor, jsonOf, textOf, ulid } from './fake-api.js'

const PROJECT = ulid('PJ1')
const TRACK = ulid('TR1')
const SHOT_A = ulid('SA1')
const SHOT_B = ulid('SB1')
const SHOT_C = ulid('SC1')
const CHAR = ulid('CH1')
const LOOK = ulid('LK1')

const shotRow = (id: string, order: number) => ({
  id,
  order,
  code: `CUT${String(order + 1)}`,
  startSec: order * 2,
  durationSec: 2,
  mood: null,
  camera: { size: 'wide', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null },
  locationId: null,
  selectedTakeId: null,
  status: 'draft',
})

const masterRoutes = [
  { method: 'GET', path: `/projects/${PROJECT}/music-tracks`, data: [{ id: TRACK, mediaAssetId: ulid('MD1'), title: '曲', isMaster: true }] },
  {
    method: 'GET',
    path: `/music-tracks/${TRACK}/analysis`,
    data: {
      durationSec: 20,
      bpm: 120,
      bpmConfidence: 0.9,
      beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4],
      downbeats: [0, 2, 4, 6, 8, 10],
      sections: [],
      energyCurve: { hopSec: 1, values: [] },
      drops: [],
    },
  },
]

describe('plan_shots', () => {
  it('小節頭へ寄せ、モデルの尺を添えて、storyboard/cuts に境界を送る', async () => {
    const fake = createFakeApi([
      ...masterRoutes,
      {
        method: 'GET',
        path: '/models',
        data: [{ id: 'vpipe/minimax-h3-turbo', label: 'H3', durations: { mode: 'enum', values: [2.333, 4.458, 10.125] }, costPerSecondUsd: 0, requiresStartFrame: true, routable: true }],
      },
      {
        method: 'POST',
        path: `/projects/${PROJECT}/storyboard/cuts`,
        status: 201,
        data: { shots: [shotRow(SHOT_A, 0), shotRow(SHOT_B, 1)], createdCount: 2, warnings: [] },
      },
    ])
    const result = jsonOf(
      await planShotsTool.run(
        { projectId: PROJECT, durationsSec: [2.2, 1.7], snap: 'downbeat', model: 'vpipe/minimax-h3-turbo' },
        depsFor(fake),
      ),
    ) as Record<string, unknown>
    expect(fake.callsTo('POST', `/projects/${PROJECT}/storyboard/cuts`)[0]?.body).toEqual({ boundariesSec: [0, 2, 4] })
    expect(result.plan).toEqual([
      { startSec: 0, durationSec: 2, generateSec: 2.333 },
      { startSec: 2, durationSec: 2, generateSec: 2.333 },
    ])
    expect(result.created).toHaveLength(2)
  })

  it('dryRun は何も作らない', async () => {
    const fake = createFakeApi([])
    const result = jsonOf(await planShotsTool.run({ projectId: PROJECT, boundariesSec: [0, 3, 7], dryRun: true }, depsFor(fake)))
    expect(result).toMatchObject({ dryRun: true, boundariesSec: [0, 3, 7] })
    expect(fake.calls).toHaveLength(0)
  })

  it('境界と尺の両方・どちらも無し・昇順でない境界を API に送る前に断る', async () => {
    const fake = createFakeApi([])
    const deps = depsFor(fake)
    expect(textOf(await planShotsTool.run({ projectId: PROJECT, boundariesSec: [0, 2], durationsSec: [2] }, deps))).toContain('どちらか一方')
    expect(textOf(await planShotsTool.run({ projectId: PROJECT }, deps))).toContain('どちらか一方')
    expect(textOf(await planShotsTool.run({ projectId: PROJECT, boundariesSec: [0, 5, 3] }, deps))).toContain('昇順')
    expect(fake.calls).toHaveLength(0)
  })

  it('知らないモデルは断る', async () => {
    const fake = createFakeApi([{ method: 'GET', path: '/models', data: [] }])
    const result = await planShotsTool.run({ projectId: PROJECT, boundariesSec: [0, 2], model: 'nope' }, depsFor(fake))
    expect(textOf(result)).toContain('model nope')
  })
})

describe('edit_shots', () => {
  const baseRoutes = [
    { method: 'GET', path: `/projects/${PROJECT}/shots`, data: [shotRow(SHOT_B, 1), shotRow(SHOT_A, 0), shotRow(SHOT_C, 2)] },
  ]

  it('中身は一括 PATCH、登場人物は既定の Look で Shot ごとに PUT、失敗は理由つきで返す', async () => {
    const fake = createFakeApi([
      ...baseRoutes,
      {
        method: 'PATCH',
        path: `/projects/${PROJECT}/shots/bulk`,
        data: { results: [{ shotId: SHOT_A, ok: true, shot: shotRow(SHOT_A, 0) }, { shotId: SHOT_B, ok: false, reason: 'ロック中' }] },
      },
      { method: 'GET', path: `/characters/${CHAR}/looks`, data: [{ id: ulid('LK0'), key: 'X', name: 'x' }, { id: LOOK, key: 'DEFAULT', name: '既定', isDefault: true }] },
      { method: 'PUT', path: /^\/shots\/.+\/characters$/, data: [] },
    ])
    const result = jsonOf(
      await editShotsTool.run(
        {
          projectId: PROJECT,
          edits: [{ shotIds: [SHOT_A, SHOT_B], description: '夕日', camera: { size: 'closeup' }, cast: [{ characterId: CHAR }] }],
        },
        depsFor(fake),
      ),
    )
    expect(fake.callsTo('PATCH', `/projects/${PROJECT}/shots/bulk`)[0]?.body).toEqual({
      shotIds: [SHOT_A, SHOT_B],
      patch: { description: '夕日', camera: { size: 'closeup' } },
    })
    expect(fake.callsTo('PUT', /characters$/).map((c) => c.body)).toEqual([
      { entries: [{ characterId: CHAR, lookId: LOOK, prominence: 'primary', order: 0 }] },
      { entries: [{ characterId: CHAR, lookId: LOOK, prominence: 'primary', order: 0 }] },
    ])
    expect(result).toEqual({
      results: [{ shotIds: [SHOT_A, SHOT_B], patched: 1, failures: [{ shotId: SHOT_B, reason: 'ロック中' }], castSet: 1 }],
    })
  })

  it('つなぎは次の Shot（order 順）へ。古い出入りを消してから作り、cut は消すだけ', async () => {
    const OLD_OUT = ulid('TN1')
    const OLD_IN = ulid('TN2')
    const fake = createFakeApi([
      ...baseRoutes,
      {
        method: 'GET',
        path: `/projects/${PROJECT}/transitions`,
        data: [
          { id: OLD_OUT, fromShotId: SHOT_A, toShotId: SHOT_C, type: 'wipe' },
          { id: OLD_IN, fromShotId: SHOT_C, toShotId: SHOT_B, type: 'wipe' },
        ],
      },
      { method: 'DELETE', path: /^\/transitions\//, status: 204 },
      { method: 'POST', path: `/projects/${PROJECT}/transitions`, status: 201, data: { id: ulid('TN3'), fromShotId: SHOT_A, toShotId: SHOT_B, type: 'dissolve' } },
    ])
    const result = jsonOf(
      await editShotsTool.run(
        { projectId: PROJECT, edits: [{ shotIds: [SHOT_A, SHOT_C], transitionToNext: { type: 'dissolve', durationSec: 0.5 } }] },
        depsFor(fake),
      ),
    )
    expect(fake.callsTo('DELETE', /^\/transitions\//).map((c) => c.path)).toEqual(
      expect.arrayContaining([`/transitions/${OLD_OUT}`, `/transitions/${OLD_IN}`]),
    )
    expect(fake.callsTo('POST', `/projects/${PROJECT}/transitions`)[0]?.body).toEqual({
      fromShotId: SHOT_A,
      toShotId: SHOT_B,
      type: 'dissolve',
      durationSec: 0.5,
    })
    // SHOT_C は最後の Shot なので次が無い。
    expect(result).toEqual({ results: [{ shotIds: [SHOT_A, SHOT_C], transitions: ['dissolve', 'skipped: no next shot'] }] })
    expect(fake.callsTo('PATCH', /bulk/)).toHaveLength(0)
  })
})

describe('登場人物・場所・最初のコマ', () => {
  it('create_character は作ってから、Shot の最初のコマを顔の画像として付ける', async () => {
    const FRAME = ulid('MD2')
    const fake = createFakeApi([
      { method: 'POST', path: `/projects/${PROJECT}/characters`, status: 201, data: { id: CHAR, name: 'hero', displayName: '主人公' } },
      { method: 'GET', path: `/shots/${SHOT_A}/start-frame`, data: { mediaAssetId: FRAME, job: null } },
      { method: 'POST', path: `/characters/${CHAR}/identity-images`, status: 201, data: { id: ulid('ID1'), mediaAssetId: FRAME, role: 'face_front' } },
      { method: 'GET', path: `/characters/${CHAR}/looks`, data: [{ id: LOOK, key: 'DEFAULT', name: '既定', isDefault: true }] },
    ])
    const result = jsonOf(
      await createCharacterTool.run(
        { projectId: PROJECT, name: 'hero', displayName: '主人公', identityAnchors: ['銀髪'], identityImage: { fromShotStartFrame: SHOT_A } },
        depsFor(fake),
      ),
    )
    expect(fake.callsTo('POST', `/projects/${PROJECT}/characters`)[0]?.body).toEqual({ name: 'hero', displayName: '主人公', identityAnchors: ['銀髪'] })
    expect(fake.callsTo('POST', `/characters/${CHAR}/identity-images`)[0]?.body).toEqual({ mediaAssetId: FRAME, role: 'face_front', isPrimary: true, order: 0 })
    expect(result).toMatchObject({ characterId: CHAR, looks: [{ id: LOOK, isDefault: true }] })
  })

  it('画像の出どころが 2 つ以上なら断る', async () => {
    const fake = createFakeApi([{ method: 'POST', path: `/projects/${PROJECT}/characters`, status: 201, data: { id: CHAR, name: 'h', displayName: 'h' } }])
    const result = await createCharacterTool.run(
      { projectId: PROJECT, name: 'h', identityImage: { mediaAssetId: ulid('MD1'), fromShotStartFrame: SHOT_A } },
      depsFor(fake),
    )
    expect(textOf(result)).toContain('どれか 1 つ')
  })

  it('create_location は参考画像の ID を並べて作る', async () => {
    const LOC = ulid('LC1')
    const fake = createFakeApi([
      { method: 'POST', path: `/projects/${PROJECT}/locations`, status: 201, data: { id: LOC, name: '海', referenceAssetIds: [ulid('MD1')] } },
    ])
    await createLocationTool.run({ projectId: PROJECT, name: '海', references: [{ mediaAssetId: ulid('MD1') }] }, depsFor(fake))
    expect(fake.calls[0]?.body).toEqual({ name: '海', referenceAssetIds: [ulid('MD1')] })
  })

  it('draw_start_frames は onlyMissing を送り、待つ手がかりを Shot ごとに返す', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/projects/${PROJECT}/start-frames/generate`, status: 202, data: { jobIds: [ulid('JB1')], skipped: { drawing: 1, hasFrame: 0 } } },
    ])
    const result = jsonOf(await drawStartFramesTool.run({ projectId: PROJECT, shotIds: [SHOT_A, SHOT_B], onlyMissing: false }, depsFor(fake)))
    expect(fake.calls[0]?.body).toEqual({ shotIds: [SHOT_A, SHOT_B], onlyMissing: false })
    expect(result).toMatchObject({ started: 1, skipped: { drawing: 1 }, next: { jobs: [{ kind: 'start_frame', id: SHOT_A }, { kind: 'start_frame', id: SHOT_B }] } })
  })

  it('set_start_frame は素材の ID を PUT する', async () => {
    const MEDIA = ulid('MD3')
    const fake = createFakeApi([
      { method: 'GET', path: `/shots/${SHOT_A}`, data: { ...shotRow(SHOT_A, 0), projectId: PROJECT } },
      { method: 'PUT', path: `/shots/${SHOT_A}/start-frame`, data: { mediaAssetId: MEDIA } },
    ])
    const result = jsonOf(await setStartFrameTool.run({ shotId: SHOT_A, mediaAssetId: MEDIA }, depsFor(fake)))
    expect(fake.callsTo('PUT', `/shots/${SHOT_A}/start-frame`)[0]?.body).toEqual({ mediaAssetId: MEDIA })
    expect(result).toEqual({ shotId: SHOT_A, mediaAssetId: MEDIA })
  })
})
