import { describe, expect, it } from 'vitest'
import { createCharacterTool, createLocationTool } from '../tools/cast.js'
import { EditShotsInput, editShotsTool } from '../tools/edit-shots.js'
import { planShotsTool } from '../tools/plan-shots.js'
import { drawStartFramesTool, setEndFrameTool, setStartFrameTool } from '../tools/start-frames.js'
import { createFakeApi, depsFor, jsonOf, ownedMedia, ownedShots, textOf, ulid } from './fake-api.js'

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

  it('別の作品の曲に寄せようとすると、何も作らずに断る', async () => {
    const fake = createFakeApi([...masterRoutes, { method: 'POST', path: `/projects/${PROJECT}/storyboard/cuts`, status: 201, data: { shots: [], warnings: [] } }])
    const result = await planShotsTool.run(
      { projectId: PROJECT, boundariesSec: [0, 2], snap: 'beat', musicTrackId: ulid('TR9') },
      depsFor(fake),
    )
    expect(textOf(result)).toContain('この作品に無い曲')
    expect(fake.calls.filter((c) => c.method !== 'GET')).toHaveLength(0)
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
      { method: 'GET', path: `/projects/${PROJECT}/characters`, data: [{ id: CHAR }] },
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

  it('別の作品の Shot・場所・キャラクター・別のキャラクターの Look は、何も書かずに断る', async () => {
    const OTHER = ulid('SX9')
    const fake = createFakeApi([
      ...baseRoutes,
      { method: 'GET', path: `/projects/${PROJECT}/locations`, data: [{ id: ulid('AR1') }] },
      { method: 'GET', path: `/projects/${PROJECT}/characters`, data: [{ id: CHAR }] },
      { method: 'GET', path: `/characters/${CHAR}/looks`, data: [{ id: LOOK, key: 'DEFAULT', name: '既定', isDefault: true }] },
    ])
    const run = (edit: Record<string, unknown>) =>
      editShotsTool.run({ projectId: PROJECT, edits: [{ shotIds: [SHOT_A], description: 'ok' }, { shotIds: [SHOT_A], ...edit }] }, depsFor(fake))
    expect(textOf(await run({ shotIds: [SHOT_A, OTHER] }))).toContain('この作品に無い Shot')
    expect(textOf(await run({ locationId: ulid('AR9') }))).toContain('この作品に無い場所')
    expect(textOf(await run({ cast: [{ characterId: ulid('CH9') }] }))).toContain('この作品に無いキャラクター')
    expect(textOf(await run({ cast: [{ characterId: CHAR, lookId: ulid('KK9') }] }))).toContain('そのキャラクターに無い Look')
    expect(fake.calls.filter((c) => c.method !== 'GET')).toHaveLength(0)
  })

  /** 速さと Take の使い始め（ADR-0050）。予告編の速い編集。 */
  it('速さと使い始めも一括 PATCH で送り、幅の外は API に送る前に断る', async () => {
    const fake = createFakeApi([
      ...baseRoutes,
      { method: 'PATCH', path: `/projects/${PROJECT}/shots/bulk`, data: { results: [{ shotId: SHOT_A, ok: true, shot: shotRow(SHOT_A, 0) }] } },
    ])
    await editShotsTool.run({ projectId: PROJECT, edits: [{ shotIds: [SHOT_A], speed: 1.5, sourceInSec: 0.2 }] }, depsFor(fake))
    expect(fake.callsTo('PATCH', `/projects/${PROJECT}/shots/bulk`)[0]?.body).toEqual({
      shotIds: [SHOT_A],
      patch: { speed: 1.5, sourceInSec: 0.2 },
    })
    expect(EditShotsInput.safeParse({ projectId: PROJECT, edits: [{ shotIds: [SHOT_A], speed: 3 }] }).success).toBe(false)
  })

  it('つなぎ方・尺の合わせ方・位置・尺は Shot ごとの PATCH で送り、失敗は理由つきで返す', async () => {
    const fake = createFakeApi([
      ...baseRoutes,
      { method: 'PATCH', path: `/shots/${SHOT_A}`, data: shotRow(SHOT_A, 0) },
      { method: 'PATCH', path: `/shots/${SHOT_B}`, status: 422, data: '入力の検証に失敗しました' },
    ])
    const result = jsonOf(
      await editShotsTool.run(
        {
          projectId: PROJECT,
          edits: [
            { shotIds: [SHOT_A, SHOT_B], continuityMode: 'previous_shot', timing: 'fit' },
            { shotIds: [SHOT_A], startSec: 1.5, durationSec: 2.75 },
          ],
        },
        depsFor(fake),
      ),
    ) as { results: Record<string, unknown>[] }
    expect(fake.callsTo('PATCH', /^\/shots\//).map((c) => [c.path, c.body])).toEqual([
      [`/shots/${SHOT_A}`, { continuityMode: 'previous_shot', timing: 'fit' }],
      [`/shots/${SHOT_B}`, { continuityMode: 'previous_shot', timing: 'fit' }],
      [`/shots/${SHOT_A}`, { startSec: 1.5, durationSec: 2.75 }],
    ])
    expect(fake.callsTo('PATCH', `/projects/${PROJECT}/shots/bulk`)).toHaveLength(0)
    expect(result.results[0]).toMatchObject({ updated: 1, failures: [{ shotId: SHOT_B }] })
    expect(result.results[1]).toEqual({ shotIds: [SHOT_A], updated: 1 })
  })

  it('Take の音の大きさと消音は Shot ごとの PATCH で送る（ADR-0060）', async () => {
    const fake = createFakeApi([
      ...baseRoutes,
      { method: 'PATCH', path: `/shots/${SHOT_A}`, data: shotRow(SHOT_A, 0) },
      { method: 'PATCH', path: `/shots/${SHOT_B}`, data: shotRow(SHOT_B, 1) },
    ])
    await editShotsTool.run(
      { projectId: PROJECT, edits: [{ shotIds: [SHOT_A, SHOT_B], takeAudioVolume: 1.3, takeAudioMuted: false }] },
      depsFor(fake),
    )
    expect(fake.callsTo('PATCH', /^\/shots\//).map((c) => [c.path, c.body])).toEqual([
      [`/shots/${SHOT_A}`, { takeAudioVolume: 1.3, takeAudioMuted: false }],
      [`/shots/${SHOT_B}`, { takeAudioVolume: 1.3, takeAudioMuted: false }],
    ])
    expect(fake.callsTo('PATCH', `/projects/${PROJECT}/shots/bulk`)).toHaveLength(0)
  })

  it('消音は null で自動（セリフのある Shot だけ鳴らす）に戻せる', async () => {
    const fake = createFakeApi([...baseRoutes, { method: 'PATCH', path: `/shots/${SHOT_A}`, data: shotRow(SHOT_A, 0) }])
    await editShotsTool.run({ projectId: PROJECT, edits: [{ shotIds: [SHOT_A], takeAudioMuted: null }] }, depsFor(fake))
    expect(fake.callsTo('PATCH', `/shots/${SHOT_A}`)[0]?.body).toEqual({ takeAudioMuted: null })
  })

  it('位置・尺は Shot が 1 つのときだけ（何も直す前に断る）', async () => {
    const fake = createFakeApi(baseRoutes)
    const result = await editShotsTool.run(
      { projectId: PROJECT, edits: [{ shotIds: [SHOT_A], mood: '静か' }, { shotIds: [SHOT_A, SHOT_B], durationSec: 2 }] },
      depsFor(fake),
    )
    expect(textOf(result)).toContain('shotIds が 1 つ')
    expect(fake.callsTo('PATCH', /.*/)).toHaveLength(0)
    expect(EditShotsInput.safeParse({ projectId: PROJECT, edits: [{ shotIds: [SHOT_A], durationSec: 0 }] }).success).toBe(false)
    expect(EditShotsInput.safeParse({ projectId: PROJECT, edits: [{ shotIds: [SHOT_A], timing: 'stretch' }] }).success).toBe(false)
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
      ownedShots(PROJECT, [SHOT_A]),
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
      ownedMedia(PROJECT),
    ])
    await createLocationTool.run({ projectId: PROJECT, name: '海', references: [{ mediaAssetId: ulid('MD1') }] }, depsFor(fake))
    expect(fake.callsTo('POST', `/projects/${PROJECT}/locations`)[0]?.body).toEqual({ name: '海', referenceAssetIds: [ulid('MD1')] })
  })

  it('create_character・create_location は別の作品の素材なら何も作らずに断る', async () => {
    const fake = createFakeApi([ownedMedia(ulid('PJ2'))])
    const character = await createCharacterTool.run(
      { projectId: PROJECT, name: 'hero', identityImage: { mediaAssetId: ulid('MD1') } },
      depsFor(fake),
    )
    expect(textOf(character)).toContain('この作品に無い素材')
    const location = await createLocationTool.run({ projectId: PROJECT, name: '海', references: [{ mediaAssetId: ulid('MD1') }] }, depsFor(fake))
    expect(textOf(location)).toContain('この作品に無い素材')
    expect(fake.calls.filter((c) => c.method !== 'GET')).toHaveLength(0)
  })

  it('draw_start_frames は onlyMissing を送り、待つ手がかりを Shot ごとに返す', async () => {
    const fake = createFakeApi([
      ownedShots(PROJECT, [SHOT_A, SHOT_B]),
      { method: 'POST', path: `/projects/${PROJECT}/start-frames/generate`, status: 202, data: { jobIds: [ulid('JB1')], skipped: { drawing: 1, hasFrame: 0 } } },
    ])
    const result = jsonOf(await drawStartFramesTool.run({ projectId: PROJECT, shotIds: [SHOT_A, SHOT_B], onlyMissing: false }, depsFor(fake)))
    expect(fake.callsTo('POST', `/projects/${PROJECT}/start-frames/generate`)[0]?.body).toEqual({ shotIds: [SHOT_A, SHOT_B], onlyMissing: false })
    expect(result).toMatchObject({ started: 1, skipped: { drawing: 1 }, next: { jobs: [{ kind: 'start_frame', id: SHOT_A }, { kind: 'start_frame', id: SHOT_B }] } })
  })

  it('set_start_frame は素材の ID を PUT する', async () => {
    const MEDIA = ulid('MD3')
    const fake = createFakeApi([
      ownedShots(PROJECT, [SHOT_A]),
      { method: 'PUT', path: `/shots/${SHOT_A}/start-frame`, data: { mediaAssetId: MEDIA } },
      ownedMedia(PROJECT),
    ])
    const result = jsonOf(await setStartFrameTool.run({ projectId: PROJECT, shotId: SHOT_A, mediaAssetId: MEDIA }, depsFor(fake)))
    expect(fake.callsTo('PUT', `/shots/${SHOT_A}/start-frame`)[0]?.body).toEqual({ mediaAssetId: MEDIA })
    expect(result).toEqual({ shotId: SHOT_A, mediaAssetId: MEDIA })
  })

  it('set_end_frame は別の Shot の最初のフレームを終わりの画像に PUT し、尺に合わせる再生になったことを返す', async () => {
    const MEDIA = ulid('MD4')
    const fake = createFakeApi([
      ownedShots(PROJECT, [SHOT_A, SHOT_B]),
      { method: 'GET', path: `/shots/${SHOT_A}/start-frame`, data: { mediaAssetId: MEDIA, job: null } },
      { method: 'PUT', path: `/shots/${SHOT_B}/end-frame`, data: { mediaAssetId: MEDIA, timing: 'fit' } },
    ])
    const result = jsonOf(
      await setEndFrameTool.run({ projectId: PROJECT, shotId: SHOT_B, fromShotStartFrame: SHOT_A }, depsFor(fake)),
    )
    expect(fake.callsTo('PUT', `/shots/${SHOT_B}/end-frame`)[0]?.body).toEqual({ mediaAssetId: MEDIA })
    expect(result).toEqual({ shotId: SHOT_B, mediaAssetId: MEDIA, timing: 'fit' })
  })

  it('set_end_frame の clear は DELETE し、画像と一緒には受けない', async () => {
    const fake = createFakeApi([
      ownedShots(PROJECT, [SHOT_A]),
      { method: 'DELETE', path: `/shots/${SHOT_A}/end-frame`, status: 204, data: null },
    ])
    const cleared = jsonOf(await setEndFrameTool.run({ projectId: PROJECT, shotId: SHOT_A, clear: true }, depsFor(fake)))
    expect(cleared).toEqual({ shotId: SHOT_A, mediaAssetId: null })
    const both = await setEndFrameTool.run({ projectId: PROJECT, shotId: SHOT_A, clear: true, mediaAssetId: ulid('MD5') }, depsFor(fake))
    expect(textOf(both)).toContain('clear=true のときは画像を指定しないでください')
    expect(fake.callsTo('DELETE', `/shots/${SHOT_A}/end-frame`)).toHaveLength(1)
  })

  it('draw_start_frames・set_start_frame は別の作品の Shot なら何も書かずに断る', async () => {
    const fake = createFakeApi([ownedShots(PROJECT, [SHOT_A]), ownedMedia(PROJECT)])
    const draw = await drawStartFramesTool.run({ projectId: PROJECT, shotIds: [SHOT_A, ulid('SX9')] }, depsFor(fake))
    expect(textOf(draw)).toContain('この作品に無い Shot')
    const set = await setStartFrameTool.run({ projectId: PROJECT, shotId: ulid('SX9'), mediaAssetId: ulid('MD3') }, depsFor(fake))
    expect(textOf(set)).toContain('この作品に無い Shot')
    expect(fake.calls.filter((c) => c.method !== 'GET')).toHaveLength(0)
  })
})
