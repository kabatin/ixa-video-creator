import { defaultEffectParams } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { addEffectsTool, listEffectsTool, removeEffectsTool } from '../tools/effects.js'
import { createFakeApi, depsFor, jsonOf, textOf, ulid } from './fake-api.js'

const PROJECT = ulid('PJ1')
const CLIP_A = ulid('CA1')
const CLIP_B = ulid('CB1')

const shotRow = (order: number, startSec: number) => ({
  id: ulid(`S${String(order)}A`),
  order,
  code: `CUT${String(order + 1)}`,
  startSec,
  durationSec: 2,
  mood: null,
  camera: { size: 'wide', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null },
  locationId: null,
  selectedTakeId: null,
  status: 'draft',
})

const clipRow = (id: string, startSec: number, templateKey: string) => ({
  id,
  track: 'VFX',
  startSec,
  durationSec: 0.4,
  content: { type: 'motion_graphics', templateKey, params: defaultEffectParams('flash') },
})

/** タイムラインの尺（60 秒）。素材の URL は読まない。 */
const timelineRoute = { method: 'GET', path: `/projects/${PROJECT}/timeline`, data: { durationSec: 60, video1: [{ mediaUrl: 'https://signed.example/x' }] } }

/** エフェクト（ADR-0050）。型と値は domain のスキーマで、送る前に全部確かめる。 */
describe('add_effects', () => {
  it('説明に型の一覧と使いどころを載せる', () => {
    expect(addEffectsTool.description).toContain('zoom_punch (寄りのパンチ')
    expect(addEffectsTool.description).toContain('scale 1.02–1.4')
    expect(addEffectsTool.description).toContain('music drop')
  })

  it('時刻と Shot の頭から VFX のクリップを作り、既定の尺と値を埋める', async () => {
    const fake = createFakeApi([
      timelineRoute,
      { method: 'GET', path: `/projects/${PROJECT}/shots`, data: [shotRow(0, 0), shotRow(1, 2.5)] },
      { method: 'POST', path: `/projects/${PROJECT}/clips`, status: 201, sequence: [{ status: 201, data: clipRow(CLIP_A, 1, 'flash') }, { status: 201, data: clipRow(CLIP_B, 2.75, 'zoom_punch') }] },
    ])
    const result = jsonOf(
      await addEffectsTool.run(
        {
          projectId: PROJECT,
          effects: [
            { template: 'flash', atSec: 1, params: { intensity: 0.5 } },
            { template: 'zoom_punch', shotCode: 'CUT2', offsetSec: 0.25, durationSec: 0.5 },
          ],
        },
        depsFor(fake),
      ),
    ) as { created: unknown[] }
    const bodies = fake.callsTo('POST', `/projects/${PROJECT}/clips`).map((c) => c.body)
    expect(bodies).toEqual([
      { track: 'VFX', startSec: 1, durationSec: 0.4, content: { type: 'motion_graphics', templateKey: 'flash', params: { ...defaultEffectParams('flash'), intensity: 0.5 } } },
      { track: 'VFX', startSec: 2.75, durationSec: 0.5, content: { type: 'motion_graphics', templateKey: 'zoom_punch', params: defaultEffectParams('zoom_punch') } },
    ])
    expect(result.created).toHaveLength(2)
  })

  it('範囲外の値があれば 1 つも置かずに断る', async () => {
    const fake = createFakeApi([timelineRoute])
    const result = await addEffectsTool.run(
      { projectId: PROJECT, effects: [{ template: 'flash', atSec: 0 }, { template: 'shake', atSec: 1, params: { intensity: 2 } }] },
      depsFor(fake),
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('effects[1].params.intensity')
    expect(fake.callsTo('POST', `/projects/${PROJECT}/clips`)).toEqual([])
  })

  it('atSec と shotCode はどちらか 1 つ', async () => {
    const result = await addEffectsTool.run({ projectId: PROJECT, effects: [{ template: 'flash' }] }, depsFor(createFakeApi([timelineRoute])))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('atSec か shotCode')
  })

  it('atSec と offsetSec を一緒に渡したら、黙って捨てずに断る', async () => {
    const fake = createFakeApi([timelineRoute])
    const result = await addEffectsTool.run({ projectId: PROJECT, effects: [{ template: 'flash', atSec: 1, offsetSec: 0.5 }] }, depsFor(fake))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('offsetSec')
    expect(fake.callsTo('POST', `/projects/${PROJECT}/clips`)).toEqual([])
  })

  it('尺はタイムラインの終わりで切り、終わりより後ろは断る（web と同じ）', async () => {
    const fake = createFakeApi([timelineRoute, { method: 'POST', path: `/projects/${PROJECT}/clips`, status: 201, data: clipRow(CLIP_A, 59, 'title_card') }])
    jsonOf(await addEffectsTool.run({ projectId: PROJECT, effects: [{ template: 'title_card', atSec: 59 }] }, depsFor(fake)))
    expect(fake.callsTo('POST', `/projects/${PROJECT}/clips`)[0]?.body).toMatchObject({ startSec: 59, durationSec: 1 })
    const beyond = await addEffectsTool.run({ projectId: PROJECT, effects: [{ template: 'flash', atSec: 60 }] }, depsFor(fake))
    expect(beyond.isError).toBe(true)
    expect(textOf(beyond)).toContain('タイムラインの終わり')
    expect(JSON.stringify(beyond)).not.toContain('signed.example')
  })

  it('知らない Shot は断る', async () => {
    const fake = createFakeApi([timelineRoute, { method: 'GET', path: `/projects/${PROJECT}/shots`, data: [shotRow(0, 0)] }])
    const result = await addEffectsTool.run({ projectId: PROJECT, effects: [{ template: 'flash', shotCode: 'CUT9' }] }, depsFor(fake))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('CUT9')
  })

  it('知らない型は入力の時点で断る', async () => {
    const result = await addEffectsTool.run({ projectId: PROJECT, effects: [{ template: 'ink_splash', atSec: 0 }] }, depsFor(createFakeApi([])))
    expect(result.isError).toBe(true)
  })
})

describe('list_effects / remove_effects', () => {
  it('VFX のエフェクトだけを時刻順に返す', async () => {
    const fake = createFakeApi([
      {
        method: 'GET',
        path: `/projects/${PROJECT}/clips`,
        data: [
          clipRow(CLIP_B, 3, 'zoom_punch'),
          { id: ulid('TX1'), track: 'TEXT', startSec: 0, durationSec: 1, content: { type: 'text', templateKey: 'plain', params: { text: 'x' } } },
          clipRow(CLIP_A, 1, 'flash'),
        ],
      },
    ])
    const result = jsonOf(await listEffectsTool.run({ projectId: PROJECT }, depsFor(fake))) as { effects: { id: string; template: string }[] }
    expect(result.effects.map((e) => [e.id, e.template])).toEqual([[CLIP_A, 'flash'], [CLIP_B, 'zoom_punch']])
  })

  it('id で外し、失敗は理由つきで返す', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}/clips`, data: [clipRow(CLIP_A, 1, 'flash'), clipRow(CLIP_B, 2, 'flash')] },
      { method: 'DELETE', path: `/clips/${CLIP_A}`, status: 204 },
      { method: 'DELETE', path: `/clips/${CLIP_B}`, status: 404, data: '対象が存在しません' },
    ])
    const result = jsonOf(await removeEffectsTool.run({ projectId: PROJECT, effectIds: [CLIP_A, CLIP_B] }, depsFor(fake))) as Record<string, unknown>
    expect(result.removed).toEqual([CLIP_A])
    expect(result.failures).toEqual([{ id: CLIP_B, reason: '404: 対象が存在しません' }])
  })

  it('エフェクトではないクリップ・この作品に無いクリップは消さない', async () => {
    const TEXT_ID = ulid('TX1')
    const fake = createFakeApi([
      {
        method: 'GET',
        path: `/projects/${PROJECT}/clips`,
        data: [{ id: TEXT_ID, track: 'TEXT', startSec: 0, durationSec: 1, content: { type: 'text', templateKey: 'plain', params: { text: 'x' } } }],
      },
    ])
    const result = jsonOf(await removeEffectsTool.run({ projectId: PROJECT, effectIds: [TEXT_ID, CLIP_A] }, depsFor(fake))) as { removed: string[]; failures: { id: string; reason: string }[] }
    expect(result.removed).toEqual([])
    expect(result.failures.map((f) => f.id)).toEqual([TEXT_ID, CLIP_A])
    expect(result.failures[0]?.reason).toContain('エフェクトではない')
    expect(fake.callsTo('DELETE', /\/clips\//)).toEqual([])
  })
})
