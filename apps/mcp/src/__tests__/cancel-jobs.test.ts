import { describe, expect, it } from 'vitest'
import { cancelJobsTool } from '../tools/cancel-jobs.js'
import { createFakeApi, depsFor, jsonOf, textOf, ulid } from './fake-api.js'

const PROJECT = ulid('PJ1')
const SHOT_A = ulid('SA1')
const SHOT_B = ulid('SB1')

const shotRow = (id: string, status: string) => ({
  id,
  order: 0,
  code: 'CUT1',
  startSec: 0,
  durationSec: 2,
  mood: null,
  camera: { size: 'wide', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null },
  locationId: null,
  selectedTakeId: null,
  status,
})

describe('cancel_jobs', () => {
  it('video は指定が無ければ生成中の Shot だけを Shot ごとの口で止める', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}/shots`, data: [shotRow(SHOT_A, 'generating'), shotRow(SHOT_B, 'draft')] },
      { method: 'POST', path: `/shots/${SHOT_A}/generations/cancel`, data: { cancelledJobIds: [ulid('JB1')], shot: shotRow(SHOT_A, 'draft') } },
    ])
    const result = jsonOf(await cancelJobsTool.run({ projectId: PROJECT, kind: 'video' }, depsFor(fake)))
    expect(fake.callsTo('POST', /generations\/cancel$/).map((c) => c.path)).toEqual([`/shots/${SHOT_A}/generations/cancel`])
    expect(result).toEqual({ kind: 'video', cancelled: 1, cancelledJobIds: [ulid('JB1')] })
  })

  it('image は shotIds を、voice は lineIds を送る。作品全体の種類は本文なし', async () => {
    const LINE = ulid('NA1')
    const fake = createFakeApi([
      { method: 'POST', path: `/projects/${PROJECT}/images/cancel`, data: { cancelledJobIds: [] } },
      { method: 'POST', path: `/projects/${PROJECT}/voice-jobs/cancel`, data: { cancelledJobIds: [ulid('JB2')] } },
      { method: 'POST', path: `/projects/${PROJECT}/upscales/cancel`, data: { cancelledJobIds: [] } },
    ])
    await cancelJobsTool.run({ projectId: PROJECT, kind: 'image', shotIds: [SHOT_B] }, depsFor(fake))
    await cancelJobsTool.run({ projectId: PROJECT, kind: 'voice', lineIds: [LINE] }, depsFor(fake))
    const upscale = jsonOf(await cancelJobsTool.run({ projectId: PROJECT, kind: 'upscale' }, depsFor(fake)))
    expect(fake.calls.map((c) => c.body)).toEqual([{ shotIds: [SHOT_B] }, { lineIds: [LINE] }, undefined])
    expect(upscale).toEqual({ kind: 'upscale', cancelled: 0, cancelledJobIds: [] })
  })

  it('種類に合わない絞り込み・別の作品の Shot は断る', async () => {
    const fake = createFakeApi([{ method: 'GET', path: `/projects/${PROJECT}/shots`, data: [] }])
    expect(textOf(await cancelJobsTool.run({ projectId: PROJECT, kind: 'music', shotIds: [SHOT_A] }, depsFor(fake)))).toContain('shotIds')
    expect(textOf(await cancelJobsTool.run({ projectId: PROJECT, kind: 'sfx', lineIds: [SHOT_A] }, depsFor(fake)))).toContain('lineIds')
    expect(textOf(await cancelJobsTool.run({ projectId: PROJECT, kind: 'video', shotIds: [SHOT_A] }, depsFor(fake)))).toContain('この作品に無い')
    expect(fake.callsTo('POST', /.*/)).toHaveLength(0)
  })
})
