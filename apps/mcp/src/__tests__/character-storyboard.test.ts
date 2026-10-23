import { describe, expect, it } from 'vitest'
import { alignToMusicTool } from '../tools/align-music.js'
import { editCharacterTool } from '../tools/character-edit.js'
import { draftStoryboardTool } from '../tools/storyboard-draft.js'
import { createFakeApi, depsFor, jsonOf, textOf, ulid, type Route } from './fake-api.js'

const PROJECT = ulid('PJ1')
const CHAR = ulid('CH1')
const LOOK = ulid('PK1')
const IMG = ulid('IM1')
const ASSET = ulid('MD1')
const SHOT = ulid('SA1')
const RUN = ulid('RN1')
const TAKE = ulid('TK1')

const owned = (projectId = PROJECT): Route => ({
  method: 'GET',
  path: `/characters/${CHAR}`,
  data: { id: CHAR, projectId, name: 'hero', displayName: '戦子' },
})
const lookRow = (overrides: Record<string, unknown> = {}) => ({ id: LOOK, characterId: CHAR, key: 'BASE', name: '基本', isDefault: true, ...overrides })

describe('edit_character', () => {
  it('別の作品のキャラクターは触らない', async () => {
    const fake = createFakeApi([owned(ulid('PJ2'))])
    const result = await editCharacterTool.run({ projectId: PROJECT, characterId: CHAR, action: 'delete' }, depsFor(fake))
    expect(textOf(result)).toContain('この作品のものではありません')
    expect(fake.callsTo('DELETE', `/characters/${CHAR}`)).toHaveLength(0)
  })

  it('add_look は key と name を送り、key が無ければ断る', async () => {
    const fake = createFakeApi([
      owned(),
      { method: 'POST', path: `/characters/${CHAR}/looks`, status: 201, data: lookRow({ key: 'WINTER', name: '冬服', isDefault: false }) },
    ])
    const result = jsonOf(
      await editCharacterTool.run(
        { projectId: PROJECT, characterId: CHAR, action: 'add_look', look: { key: 'WINTER', name: '冬服', wardrobeTokens: ['紺のコート'] } },
        depsFor(fake),
      ),
    ) as { key: string }
    expect(result.key).toBe('WINTER')
    expect(fake.callsTo('POST', `/characters/${CHAR}/looks`)[0]?.body).toEqual({ key: 'WINTER', name: '冬服', wardrobeTokens: ['紺のコート'] })
    const noKey = await editCharacterTool.run(
      { projectId: PROJECT, characterId: CHAR, action: 'add_look', look: { name: '冬服' } },
      depsFor(fake),
    )
    expect(noKey.isError).toBe(true)
  })

  it('小文字の key・Look の key の変更は断る', async () => {
    const fake = createFakeApi([owned(), { method: 'GET', path: `/looks/${LOOK}`, data: lookRow() }])
    const lower = await editCharacterTool.run(
      { projectId: PROJECT, characterId: CHAR, action: 'add_look', look: { key: 'winter', name: '冬服' } },
      depsFor(fake),
    )
    expect(lower.isError).toBe(true)
    const rekey = await editCharacterTool.run(
      { projectId: PROJECT, characterId: CHAR, action: 'update_look', lookId: LOOK, look: { key: 'NEW' } },
      depsFor(fake),
    )
    expect(textOf(rekey)).toContain('key は変えられません')
    expect(fake.callsTo('PATCH', /looks/)).toHaveLength(0)
    expect(fake.callsTo('POST', /looks/)).toHaveLength(0)
  })

  it('別のキャラクターの Look は消さない', async () => {
    const fake = createFakeApi([owned(), { method: 'GET', path: `/looks/${LOOK}`, data: lookRow({ characterId: ulid('CH2') }) }])
    const result = await editCharacterTool.run(
      { projectId: PROJECT, characterId: CHAR, action: 'delete_look', lookId: LOOK },
      depsFor(fake),
    )
    expect(result.isError).toBe(true)
    expect(fake.callsTo('DELETE', /looks/)).toHaveLength(0)
  })

  it('識別用画像は同じ役の最初の 1 枚を主にし、役の名前を検査する', async () => {
    const path = `/characters/${CHAR}/identity-images`
    const fake = createFakeApi([
      owned(),
      { method: 'GET', path, data: [{ id: IMG, mediaAssetId: ulid('MD2'), role: 'face_front', isPrimary: true }] },
      { method: 'POST', path, status: 201, data: { id: ulid('IM2'), mediaAssetId: ASSET, role: 'full_body', isPrimary: true } },
    ])
    jsonOf(
      await editCharacterTool.run(
        { projectId: PROJECT, characterId: CHAR, action: 'add_identity_image', image: { mediaAssetId: ASSET }, role: 'full_body' },
        depsFor(fake),
      ),
    )
    expect(fake.callsTo('POST', path)[0]?.body).toEqual({ mediaAssetId: ASSET, role: 'full_body', isPrimary: true, order: 1 })
    const lookRole = await editCharacterTool.run(
      { projectId: PROJECT, characterId: CHAR, action: 'add_identity_image', image: { mediaAssetId: ASSET }, role: 'wardrobe' },
      depsFor(fake),
    )
    expect(textOf(lookRole)).toContain('role は')
    expect(fake.callsTo('POST', path)).toHaveLength(1)
  })

  it('一覧に無い識別用画像は消さない', async () => {
    const fake = createFakeApi([owned(), { method: 'GET', path: `/characters/${CHAR}/identity-images`, data: [] }])
    const result = await editCharacterTool.run(
      { projectId: PROJECT, characterId: CHAR, action: 'remove_identity_image', imageId: IMG },
      depsFor(fake),
    )
    expect(result.isError).toBe(true)
    expect(fake.callsTo('DELETE', /identity-images/)).toHaveLength(0)
  })

  it('キャラクターシートはジョブを始めるだけ', async () => {
    const fake = createFakeApi([
      owned(),
      { method: 'POST', path: `/characters/${CHAR}/character-sheet`, status: 202, data: { jobId: ulid('JB1') } },
    ])
    const result = jsonOf(
      await editCharacterTool.run({ projectId: PROJECT, characterId: CHAR, action: 'make_character_sheet' }, depsFor(fake)),
    ) as { jobId: string }
    expect(result.jobId).toBe(ulid('JB1'))
    expect(fake.callsTo('POST', `/characters/${CHAR}/character-sheet`)[0]?.body).toEqual({})
  })
})

const shotsRoute: Route = {
  method: 'GET',
  path: `/projects/${PROJECT}/shots`,
  data: [
    {
      id: SHOT,
      order: 0,
      code: 'CUT1',
      startSec: 0,
      durationSec: 2.5,
      description: '',
      mood: null,
      camera: { size: 'wide', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null },
      locationId: null,
      selectedTakeId: null,
      status: 'draft',
    },
  ],
}

describe('align_to_music', () => {
  const move = { kind: 'move', shotId: SHOT, fromSec: 0.1, toSec: 0, reason: '拍に寄せる' }

  it('check は拍から外れた境目だけを出す', async () => {
    const fake = createFakeApi([
      shotsRoute,
      { method: 'GET', path: `/projects/${PROJECT}/timeline/issues`, data: [] },
      {
        method: 'GET',
        path: `/projects/${PROJECT}/timeline/beat-alignment`,
        data: {
          source: 'available',
          trackTitle: '曲',
          shots: [
            { shotId: SHOT, atSec: 0.12, driftSec: 0.12, alignment: 'off_beat' },
            { shotId: ulid('SB1'), atSec: 2.5, driftSec: 0, alignment: 'on_downbeat' },
          ],
        },
      },
    ])
    const result = jsonOf(await alignToMusicTool.run({ projectId: PROJECT, action: 'check' }, depsFor(fake))) as {
      cutsChecked: number
      offBeatCuts: { code: string }[]
    }
    expect(result.cutsChecked).toBe(2)
    expect(result.offBeatCuts).toEqual([{ code: 'CUT1', shotId: SHOT, atSec: 0.12, driftSec: 0.12, alignment: 'off_beat' }])
  })

  it('plan の結果をそのまま apply に送り返せる（code は落ちる）', async () => {
    const fake = createFakeApi([
      shotsRoute,
      { method: 'POST', path: `/projects/${PROJECT}/timeline/rough-cut/plan`, data: { changes: [move], unresolved: [] } },
      { method: 'POST', path: `/projects/${PROJECT}/timeline/rough-cut/apply`, data: { applied: [move], skipped: [] } },
    ])
    const plan = jsonOf(await alignToMusicTool.run({ projectId: PROJECT, action: 'plan' }, depsFor(fake))) as { changes: unknown[] }
    expect(plan.changes).toEqual([{ code: 'CUT1', ...move }])
    jsonOf(await alignToMusicTool.run({ projectId: PROJECT, action: 'apply', changes: plan.changes }, depsFor(fake)))
    expect(fake.callsTo('POST', `/projects/${PROJECT}/timeline/rough-cut/apply`)[0]?.body).toMatchObject({ changes: [move] })
  })

  it('apply に changes が無い・知らない種類・負の秒は断る', async () => {
    const fake = createFakeApi([])
    for (const changes of [undefined, [{ ...move, kind: 'swap' }], [{ ...move, toSec: -1 }], [{ kind: 'select', shotId: SHOT, takeId: TAKE, reason: '' }]]) {
      const result = await alignToMusicTool.run({ projectId: PROJECT, action: 'apply', changes }, depsFor(fake))
      expect(result.isError).toBe(true)
    }
    expect(fake.calls).toHaveLength(0)
  })

  it('trim_music は曲を切った結果を返す', async () => {
    const fake = createFakeApi([
      {
        method: 'POST',
        path: `/projects/${PROJECT}/music-tracks/trim-to-shots`,
        data: { track: { id: ulid('TR1'), title: '曲', endSec: 116 }, editBatchId: ulid('EB1') },
      },
    ])
    const result = jsonOf(await alignToMusicTool.run({ projectId: PROJECT, action: 'trim_music' }, depsFor(fake)))
    expect(result).toEqual({ trackId: ulid('TR1'), title: '曲', endSec: 116, changed: true })
  })
})

describe('draft_storyboard', () => {
  const item = {
    shotId: SHOT,
    description: '夕焼けの校庭',
    mood: '切ない',
    reason: 'サビ前',
    camera: null,
    adoptedAt: null,
  }
  const run = { id: RUN, drafter: 'claude_cli', status: 'done', error: null, createdAt: '2026-10-23T00:00:00Z' }

  it('draft は案を Shot のコード付きで返す', async () => {
    const fake = createFakeApi([
      shotsRoute,
      { method: 'POST', path: `/projects/${PROJECT}/storyboard/drafts`, status: 201, data: { run, items: [item] } },
    ])
    const result = jsonOf(await draftStoryboardTool.run({ projectId: PROJECT, action: 'draft' }, depsFor(fake))) as {
      items: { code: string; adopted: boolean }[]
    }
    expect(result.items[0]).toMatchObject({ code: 'CUT1', adopted: false, description: '夕焼けの校庭' })
  })

  it('adopt は列挙した Shot だけを送り、空・重複は断る', async () => {
    const fake = createFakeApi([
      {
        method: 'POST',
        path: `/projects/${PROJECT}/storyboard/drafts/${RUN}/adopt`,
        data: { adopted: [item], shots: shotsRoute.data },
      },
    ])
    jsonOf(await draftStoryboardTool.run({ projectId: PROJECT, action: 'adopt', runId: RUN, shotIds: [SHOT] }, depsFor(fake)))
    expect(fake.calls[0]?.body).toEqual({ shotIds: [SHOT] })
    for (const shotIds of [undefined, [], [SHOT, SHOT]]) {
      const result = await draftStoryboardTool.run({ projectId: PROJECT, action: 'adopt', runId: RUN, shotIds }, depsFor(fake))
      expect(result.isError).toBe(true)
    }
    expect(fake.calls).toHaveLength(1)
  })

  it('suggest は欄と対象を送り、指示の空は null にする', async () => {
    const fake = createFakeApi([{ method: 'POST', path: `/projects/${PROJECT}/assist`, data: { text: '雨の街', costUsd: 0 } }])
    const result = jsonOf(
      await draftStoryboardTool.run(
        { projectId: PROJECT, action: 'suggest', field: 'shot_description', shotId: SHOT, instruction: '' },
        depsFor(fake),
      ),
    )
    expect(result).toEqual({ field: 'shot_description', text: '雨の街', costUsd: 0 })
    expect(fake.calls[0]?.body).toEqual({ field: 'shot_description', current: '', instruction: null, shotId: SHOT })
    const tooLong = await draftStoryboardTool.run(
      { projectId: PROJECT, action: 'suggest', field: 'concept', instruction: 'あ'.repeat(301) },
      depsFor(fake),
    )
    expect(tooLong.isError).toBe(true)
  })
})
