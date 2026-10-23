import { describe, expect, it } from 'vitest'
import { insertOrder, restructureShotsTool } from '../tools/restructure-shots.js'
import { createFakeApi, depsFor, jsonOf, textOf, ulid } from './fake-api.js'

const PROJECT = ulid('PJ1')
const SHOT_A = ulid('SA1')
const SHOT_B = ulid('SB1')
const FOREIGN = ulid('SF1')

const shotRow = (id: string, order: number) => ({
  id,
  order,
  code: `CUT${String(order)}`,
  startSec: order / 500,
  durationSec: 2,
  mood: null,
  camera: { size: 'wide', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null },
  locationId: null,
  selectedTakeId: null,
  status: 'draft',
})

const listRoute = { method: 'GET', path: `/projects/${PROJECT}/shots`, data: [shotRow(SHOT_B, 2000), shotRow(SHOT_A, 1000)] }

describe('restructure_shots', () => {
  it('split は位置を送り、前半と後半の ID を返す', async () => {
    const fake = createFakeApi([
      listRoute,
      { method: 'POST', path: `/shots/${SHOT_A}/split`, data: { first: shotRow(SHOT_A, 1000), second: shotRow(ulid('SN1'), 1500) } },
    ])
    const result = jsonOf(await restructureShotsTool.run({ projectId: PROJECT, action: 'split', shotId: SHOT_A, atSec: 1.25 }, depsFor(fake)))
    expect(fake.callsTo('POST', `/shots/${SHOT_A}/split`)[0]?.body).toEqual({ atSec: 1.25 })
    expect(result).toEqual({ action: 'split', first: SHOT_A, second: ulid('SN1') })
  })

  it('merge は作品の口へ shotIds を送る', async () => {
    const fake = createFakeApi([
      listRoute,
      { method: 'POST', path: `/projects/${PROJECT}/shots/merge`, data: { shot: { ...shotRow(SHOT_A, 1000), durationSec: 4 }, removedShotIds: [SHOT_B] } },
    ])
    const result = jsonOf(await restructureShotsTool.run({ projectId: PROJECT, action: 'merge', shotIds: [SHOT_A, SHOT_B] }, depsFor(fake)))
    expect(fake.calls[1]?.body).toEqual({ shotIds: [SHOT_A, SHOT_B] })
    expect(result).toEqual({ action: 'merge', shotId: SHOT_A, durationSec: 4, removedShotIds: [SHOT_B] })
  })

  it('delete は 1 本なら取り消せる口、2 本以上はまとめて消す口（失敗は理由つき）', async () => {
    const fake = createFakeApi([
      listRoute,
      { method: 'DELETE', path: `/shots/${SHOT_A}`, status: 204 },
      {
        method: 'POST',
        path: `/projects/${PROJECT}/shots/bulk/delete`,
        data: { results: [{ shotId: SHOT_A, ok: true }, { shotId: SHOT_B, ok: false, reason: 'ロック中' }], deletedCount: 1 },
      },
    ])
    const one = jsonOf(await restructureShotsTool.run({ projectId: PROJECT, action: 'delete', shotIds: [SHOT_A] }, depsFor(fake)))
    expect(one).toEqual({ action: 'delete', deletedCount: 1, undoable: true })
    const many = jsonOf(await restructureShotsTool.run({ projectId: PROJECT, action: 'delete', shotIds: [SHOT_A, SHOT_B] }, depsFor(fake)))
    expect(many).toEqual({ action: 'delete', deletedCount: 1, undoable: false, failures: [{ shotId: SHOT_B, reason: 'ロック中' }] })
  })

  it('別の作品の Shot は API に送る前に断る', async () => {
    const fake = createFakeApi([listRoute])
    const result = await restructureShotsTool.run({ projectId: PROJECT, action: 'delete', shotIds: [FOREIGN] }, depsFor(fake))
    expect(textOf(result)).toContain('この作品に無い Shot')
    expect(fake.callsTo('DELETE', /.*/)).toHaveLength(0)
  })

  it('insert は直後の Shot との間の order で、台詞つきで作る', async () => {
    const created = ulid('SN2')
    const fake = createFakeApi([
      listRoute,
      { method: 'POST', path: `/projects/${PROJECT}/shots`, status: 201, data: { ...shotRow(created, 1500), code: 'CUT1B' } },
    ])
    const result = jsonOf(
      await restructureShotsTool.run(
        {
          projectId: PROJECT,
          action: 'insert',
          afterShotId: SHOT_A,
          code: 'CUT1B',
          startSec: 2,
          durationSec: 1.5,
          dialogue: 'いくぞ',
          camera: { size: 'closeup' },
        },
        depsFor(fake),
      ),
    )
    expect(fake.callsTo('POST', `/projects/${PROJECT}/shots`)[0]?.body).toEqual({
      sequenceId: null,
      order: 1500,
      code: 'CUT1B',
      startSec: 2,
      durationSec: 1.5,
      sourceInSec: 0,
      description: '',
      dialogue: 'いくぞ',
      camera: { size: 'closeup', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null },
      mood: null,
      locationId: null,
      sourceType: { type: 'ai_video' },
      status: 'draft',
    })
    expect(result).toEqual({ action: 'insert', shotId: created, code: 'CUT1B', order: 1500 })
  })

  it('insertOrder: 末尾は +1000、隙間が無ければ断る', () => {
    const shots = [shotRow(SHOT_A, 1000), shotRow(SHOT_B, 1001)]
    expect(insertOrder(shots, undefined)).toBe(2001)
    expect(insertOrder(shots, SHOT_B)).toBe(2001)
    expect(insertOrder([], undefined)).toBe(1000)
    expect(() => insertOrder(shots, SHOT_A)).toThrow('隙間')
  })

  it('動作に要る欄が無ければ断る', async () => {
    const fake = createFakeApi([listRoute])
    expect(textOf(await restructureShotsTool.run({ projectId: PROJECT, action: 'split', shotId: SHOT_A }, depsFor(fake)))).toContain('atSec')
    expect(textOf(await restructureShotsTool.run({ projectId: PROJECT, action: 'merge', shotIds: [SHOT_A] }, depsFor(fake)))).toContain('2 つ以上')
    expect(textOf(await restructureShotsTool.run({ projectId: PROJECT, action: 'insert', code: 'X' }, depsFor(fake)))).toContain('durationSec')
  })
})
