import { describe, expect, it } from 'vitest'
import { createCharacterTool } from '../tools/cast.js'
import { EditCharacterInput, editCharacterTool } from '../tools/character-edit.js'
import { editShotsTool } from '../tools/edit-shots.js'
import { planShotsTool } from '../tools/plan-shots.js'
import { createFakeApi, depsFor, jsonOf, ownedShots, textOf, ulid } from './fake-api.js'

/**
 * 会話劇の MCP（ADR-0059）。セリフは edit_shots（Shot ごとの PATCH で丸ごと置き換え）と plan_shots（カットごと）。
 * 話し手は作品のキャラクターだけ。長すぎる警告は結果に載せて返す。キャラクターの声は edit_character。
 */

const PROJECT = ulid('PJ1')
const SHOT_A = ulid('SA1')
const SHOT_B = ulid('SB1')
const CAT = ulid('CH1')
const STRANGER = ulid('CH9')

const shotRow = (id: string, order: number, warnings: readonly string[] = []) => ({
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
  dialogueWarnings: warnings.map((message) => ({ code: 'too_many_lines', message })),
})

const line = (text: string) => ({ speakerId: CAT, text })

describe('edit_shots の dialogue', () => {
  it('Shot ごとの PATCH で丸ごと置き換え、長すぎる警告を結果に載せる', async () => {
    const fake = createFakeApi([
      ownedShots(PROJECT, [SHOT_A]),
      { method: 'GET', path: `/projects/${PROJECT}/characters`, data: [{ id: CAT }] },
      { method: 'PATCH', path: `/shots/${SHOT_A}`, data: shotRow(SHOT_A, 0, ['長すぎます（10 秒に 3〜4 行まで）']) },
    ])
    const lines = Array.from({ length: 5 }, (_, i) => line(`セリフ${String(i)}`))
    const result = jsonOf(
      await editShotsTool.run({ projectId: PROJECT, edits: [{ shotIds: [SHOT_A], dialogue: lines }] }, depsFor(fake)),
    ) as { results: Record<string, unknown>[] }

    expect(fake.callsTo('PATCH', `/shots/${SHOT_A}`)[0]?.body).toEqual({ dialogue: lines })
    // 一括の口には送らない（受けない列）
    expect(fake.callsTo('PATCH', `/projects/${PROJECT}/shots/bulk`)).toHaveLength(0)
    expect(result.results[0]?.dialogueWarnings).toEqual([
      { shotId: SHOT_A, warnings: ['長すぎます（10 秒に 3〜4 行まで）'] },
    ])
  })

  it('この作品に無いキャラクターを話し手にしたら、何も直さずに断る', async () => {
    const fake = createFakeApi([
      ownedShots(PROJECT, [SHOT_A]),
      { method: 'GET', path: `/projects/${PROJECT}/characters`, data: [{ id: CAT }] },
    ])
    const result = await editShotsTool.run(
      { projectId: PROJECT, edits: [{ shotIds: [SHOT_A], dialogue: [{ speakerId: STRANGER, text: 'だれ？' }] }] },
      depsFor(fake),
    )
    expect(textOf(result)).toContain('この作品に無い話し手です')
    expect(fake.callsTo('PATCH', `/shots/${SHOT_A}`)).toHaveLength(0)
  })

  it('空のセリフ・21 行は入力の時点で断る', async () => {
    const fake = createFakeApi([])
    const empty = await editShotsTool.run(
      { projectId: PROJECT, edits: [{ shotIds: [SHOT_A], dialogue: [line('  ')] }] },
      depsFor(fake),
    )
    expect(empty.isError).toBe(true)
    const tooMany = await editShotsTool.run(
      { projectId: PROJECT, edits: [{ shotIds: [SHOT_A], dialogue: Array.from({ length: 21 }, () => line('あ')) }] },
      depsFor(fake),
    )
    expect(tooMany.isError).toBe(true)
    expect(fake.calls).toHaveLength(0)
  })
})

describe('plan_shots の dialogues', () => {
  it('カットごとのセリフを storyboard/cuts に送り、警告を Shot の名前つきで返す', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}/characters`, data: [{ id: CAT }] },
      {
        method: 'POST',
        path: `/projects/${PROJECT}/storyboard/cuts`,
        status: 201,
        data: { shots: [shotRow(SHOT_A, 0), shotRow(SHOT_B, 1, ['長すぎます（10 秒に 3〜4 行まで）'])], createdCount: 2, warnings: [] },
      },
    ])
    const dialogues = [[line('ねえ')], []]
    const result = jsonOf(
      await planShotsTool.run({ projectId: PROJECT, boundariesSec: [0, 2, 4], dialogues }, depsFor(fake)),
    ) as { warnings: string[] }

    expect(fake.callsTo('POST', `/projects/${PROJECT}/storyboard/cuts`)[0]?.body).toEqual({ boundariesSec: [0, 2, 4], dialogues })
    expect(result.warnings).toEqual(['CUT2: 長すぎます（10 秒に 3〜4 行まで）'])
  })

  it('Shot の数と合わなければ作らずに断る', async () => {
    const fake = createFakeApi([])
    const result = await planShotsTool.run(
      { projectId: PROJECT, boundariesSec: [0, 2, 4], dialogues: [[line('ねえ')]] },
      depsFor(fake),
    )
    expect(textOf(result)).toContain('Shot の数（2）')
    expect(fake.calls).toHaveLength(0)
  })
})

describe('キャラクターの声', () => {
  const character = { id: CAT, projectId: PROJECT, name: 'neko', displayName: 'ネコ', speakerNo: 2, speechName: 'The cat', voiceDescription: 'a soft voice' }

  it('edit_character の update で呼び名と声の説明を送り、話し手の印を返す', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/characters/${CAT}`, data: character },
      { method: 'PATCH', path: `/characters/${CAT}`, data: character },
      { method: 'GET', path: `/characters/${CAT}/looks`, data: [] },
      { method: 'GET', path: `/characters/${CAT}/identity-images`, data: [] },
      { method: 'GET', path: `/characters/${CAT}/character-sheet`, data: { job: null } },
    ])
    const result = jsonOf(
      await editCharacterTool.run(
        {
          projectId: PROJECT,
          characterId: CAT,
          action: 'update',
          character: { speechName: 'The cat', voiceDescription: 'a soft voice' },
        },
        depsFor(fake),
      ),
    ) as { character: Record<string, unknown> }

    expect(fake.callsTo('PATCH', `/characters/${CAT}`)[0]?.body).toEqual({ speechName: 'The cat', voiceDescription: 'a soft voice' })
    expect(result.character).toMatchObject({ speakerTag: 'S2', speechName: 'The cat', voiceDescription: 'a soft voice' })
  })

  it('update で character を包まずに呼び名を渡したら、何も送らずに正しい形を例で示す', async () => {
    const fake = createFakeApi([{ method: 'GET', path: `/characters/${CAT}`, data: character }])
    // 上に置いた speechName は入力の形に無いので落ちる。届くのは character の無い update。
    const result = await editCharacterTool.run(
      { projectId: PROJECT, characterId: CAT, action: 'update', speechName: 'The cat' },
      depsFor(fake),
    )
    expect(textOf(result)).toContain('"character":{"speechName"')
    expect(fake.callsTo('PATCH', `/characters/${CAT}`)).toHaveLength(0)
  })

  it('edit_character の説明と character の欄が、呼び名と声の説明を character の中に書くと教える', () => {
    expect(editCharacterTool.description).toContain('character: {speechName, voiceDescription}')
    expect(EditCharacterInput.shape.character.description).toContain('speechName')
  })

  it('create_character でも呼び名と声の説明を付けて作れる', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/projects/${PROJECT}/characters`, status: 201, data: { id: CAT, name: 'neko', displayName: 'ネコ' } },
      { method: 'GET', path: `/characters/${CAT}/looks`, data: [] },
    ])
    await createCharacterTool.run(
      { projectId: PROJECT, name: 'neko', speechName: 'The cat', voiceDescription: 'a soft voice' },
      depsFor(fake),
    )
    expect(fake.callsTo('POST', `/projects/${PROJECT}/characters`)[0]?.body).toMatchObject({
      speechName: 'The cat',
      voiceDescription: 'a soft voice',
    })
  })
})
