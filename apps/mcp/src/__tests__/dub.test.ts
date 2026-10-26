import { describe, expect, it } from 'vitest'
import { editCharacterTool } from '../tools/character-edit.js'
import { designVoiceTool, dubTakesTool } from '../tools/dub.js'
import { editShotsTool } from '../tools/edit-shots.js'
import { statusTool } from '../tools/status.js'
import { waitTool } from '../tools/wait.js'
import { createFakeApi, depsFor, jsonOf, ownedShots, textOf, ulid } from './fake-api.js'

/**
 * 声の差し替え（ADR-0062 段 5b）の MCP。dub_takes で積み、wait の kind:"dub" で待つ。行ごとの指定は edit_shots の dub、
 * セリフの声と距離は edit_character、説明から声を作るのは design_voice。
 */

const PROJECT = ulid('PJ1')
const OTHER = ulid('PJ2')
const SHOT_A = ulid('SA1')
const SHOT_B = ulid('SB1')
const TAKE = ulid('TK1')
const NEW_TAKE = ulid('TK2')
const JOB = ulid('DB1')
const CAT = ulid('CH1')
const VOICE = ulid('VC1')

const job = (patch: Record<string, unknown> = {}) => ({
  id: JOB,
  projectId: PROJECT,
  shotId: SHOT_A,
  sourceTakeId: TAKE,
  status: 'queued',
  takeId: null,
  costUsd: 0,
  error: null,
  record: null,
  queuedAt: '2026-10-26T00:00:00Z',
  startedAt: null,
  finishedAt: null,
  ...patch,
})

const record = {
  kind: 'dub',
  sourceTakeId: TAKE,
  voiceTool: 'gemini_api',
  model: 'gemini-3.8-flash-tts',
  integratedLufs: -16,
  lines: [
    {
      lineIndex: 0,
      mode: 'lip',
      added: false,
      sourceStartSec: 0.5,
      sourceEndSec: 1.5,
      placedStartSec: 0.46,
      placedEndSec: 1.6612,
      agreement: 0.9134,
      tempoMin: 1.2,
      tempoMax: 1.45,
      reading: 'pause',
      warnings: [{ code: 'fast_tempo', message: '早口に聞こえます。読み方の指示か Shot の指示を直してください' }],
    },
  ],
}

describe('dub_takes', () => {
  it('Shot ごとに積み、断られた Shot は理由を返し、wait の手がかりを返す', async () => {
    const fake = createFakeApi([
      ownedShots(PROJECT, [SHOT_A, SHOT_B]),
      { method: 'POST', path: `/shots/${SHOT_A}/dub`, status: 202, data: job() },
      { method: 'POST', path: `/shots/${SHOT_B}/dub`, status: 409, data: 'この Shot の声を差し替えている最中です' },
    ])
    const result = jsonOf(await dubTakesTool.run({ projectId: PROJECT, shotIds: [SHOT_A, SHOT_B] }, depsFor(fake))) as Record<string, unknown>
    expect(result).toMatchObject({
      queued: 1,
      results: [
        { shotId: SHOT_A, ok: true, jobId: JOB, sourceTakeId: TAKE },
        { shotId: SHOT_B, ok: false, reason: expect.stringContaining('差し替えている最中') as unknown },
      ],
      next: { tool: 'wait', jobs: [{ kind: 'dub', id: JOB }] },
    })
    expect(String((result.results as { reason?: string }[])[1]?.reason)).toContain('409')
  })

  it('音の無い Take などの 422 もそのまま理由にする', async () => {
    const fake = createFakeApi([
      ownedShots(PROJECT, [SHOT_A]),
      { method: 'POST', path: `/shots/${SHOT_A}/dub`, status: 422, data: '採用している Take に音がありません（音付きで作った Take だけ差し替えられます）' },
    ])
    const result = jsonOf(await dubTakesTool.run({ projectId: PROJECT, shotIds: [SHOT_A] }, depsFor(fake))) as Record<string, unknown>
    expect(result).toMatchObject({ queued: 0, results: [{ ok: false, reason: expect.stringContaining('音がありません') as unknown }] })
    expect(result).not.toHaveProperty('next')
  })

  it('同じ Shot を 2 度渡したら 1 本も積まない（二重に払わない）', async () => {
    const fake = createFakeApi([ownedShots(PROJECT, [SHOT_A])])
    await expect(dubTakesTool.run({ projectId: PROJECT, shotIds: [SHOT_A, SHOT_A] }, depsFor(fake))).resolves.toBeDefined()
    expect(fake.callsTo('POST', /\/dub$/)).toHaveLength(0)
  })

  it('別の作品の Shot が混じれば 1 本も積まない', async () => {
    const fake = createFakeApi([ownedShots(PROJECT, [SHOT_A])])
    const result = await dubTakesTool.run({ projectId: PROJECT, shotIds: [SHOT_A, SHOT_B] }, depsFor(fake))
    expect(textOf(result)).toContain(SHOT_B)
    expect(fake.callsTo('POST', /\/dub$/)).toHaveLength(0)
  })
})

describe('wait の kind:"dub"', () => {
  it('待っている間は pending、できたら新しい Take と行ごとの一致率・伸縮の幅・警告を返す', async () => {
    const fake = createFakeApi([
      {
        method: 'GET',
        path: `/dub-jobs/${JOB}`,
        sequence: [
          { data: job() },
          { data: job({ status: 'running' }) },
          { data: job({ status: 'running' }) },
          { data: job({ status: 'succeeded', takeId: NEW_TAKE, record }) },
        ],
      },
    ])
    const outcome = jsonOf(await waitTool.run({ projectId: PROJECT, jobs: [{ kind: 'dub', id: JOB }] }, depsFor(fake))) as {
      results: Record<string, unknown>[]
    }
    expect(outcome.results[0]).toMatchObject({
      kind: 'dub',
      state: 'succeeded',
      takeId: NEW_TAKE,
      sourceTakeId: TAKE,
      lines: [{ lineIndex: 0, mode: 'lip', agreement: 0.91, tempoMin: 1.2, tempoMax: 1.45, placedSec: [0.46, 1.661], warnings: [record.lines[0]?.warnings[0]?.message] }],
    })
  })

  it('失敗したら理由と行の区間の案を返す', async () => {
    const suggestedSpans = [
      { lineIndex: 0, startSec: 0.2, endSec: 0.65 },
      { lineIndex: 1, startSec: 0.65, endSec: 2 },
    ]
    const error = { code: 'lines_unassigned', message: 'セリフの 1・2 行目に割り当てる元の声の区間が足りません', retryable: false, suggestedSpans }
    const fake = createFakeApi([{ method: 'GET', path: `/dub-jobs/${JOB}`, data: job({ status: 'failed', error }) }])
    const outcome = jsonOf(await waitTool.run({ projectId: PROJECT, jobs: [{ kind: 'dub', id: JOB }] }, depsFor(fake))) as {
      results: Record<string, unknown>[]
    }
    expect(outcome.results[0]).toMatchObject({ state: 'failed', error: error.message, suggestedSpans })
    expect(String(outcome.results[0]?.hint)).toContain('dub.startSec')
  })

  it('別の作品のジョブは待たない（状態も中身も返さない）', async () => {
    const fake = createFakeApi([{ method: 'GET', path: `/dub-jobs/${JOB}`, data: job({ projectId: OTHER, status: 'succeeded', takeId: NEW_TAKE, record }) }])
    const result = await waitTool.run({ projectId: PROJECT, jobs: [{ kind: 'dub', id: JOB }] }, depsFor(fake))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain(JOB)
    expect(textOf(result)).not.toContain(NEW_TAKE)
  })

  it('jobs を省くと、作品の差し替えが止むまで待つ。ixa_status にも動いている差し替えが出る', async () => {
    const routes = [
      { method: 'GET', path: `/projects/${PROJECT}/generations/active`, data: [] },
      { method: 'GET', path: `/projects/${PROJECT}/shot-posters`, data: [] },
      { method: 'GET', path: `/projects/${PROJECT}/renders`, data: [] },
      { method: 'GET', path: `/projects/${PROJECT}/dubs/active`, data: [job({ status: 'running' })] },
    ]
    const outcome = jsonOf(await waitTool.run({ projectId: PROJECT, maxWaitSec: 10 }, depsFor(createFakeApi(routes)))) as {
      results: Record<string, unknown>[]
    }
    expect(outcome.results[0]).toMatchObject({ kind: 'project', state: 'pending', dubsActive: 1 })

    const status = jsonOf(
      await statusTool.run(
        { projectId: PROJECT },
        depsFor(
          createFakeApi([
            ...routes,
            { method: 'GET', path: '/health', data: { status: 'ok', uptimeSec: 1 } },
            { method: 'GET', path: '/ai/tools', data: { tools: [] } },
            { method: 'GET', path: '/ai/settings', data: { settings: {}, source: 'default' } },
            { method: 'GET', path: '/models', data: [] },
            { method: 'GET', path: '/projects', data: [] },
          ]),
        ),
      ),
    ) as Record<string, unknown>
    expect(status.activeDubs).toEqual([{ jobId: JOB, shotId: SHOT_A, status: 'running', sourceTakeId: TAKE }])
  })
})

describe('edit_shots の dub', () => {
  const shotRow = {
    id: SHOT_A,
    order: 0,
    code: 'CUT1',
    startSec: 0,
    durationSec: 6,
    mood: null,
    camera: { size: 'wide', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null },
    locationId: null,
    selectedTakeId: null,
    status: 'draft',
  }

  it('行の差し替えの指定をそのまま送る', async () => {
    const fake = createFakeApi([
      ownedShots(PROJECT, [SHOT_A]),
      { method: 'GET', path: `/projects/${PROJECT}/characters`, data: [{ id: CAT }] },
      { method: 'PATCH', path: `/shots/${SHOT_A}`, data: shotRow },
    ])
    const dialogue = [
      { speakerId: CAT, text: 'ねえ。', dub: { style: 'ささやく', levelDb: -6.5, startSec: 0.2, endSec: 1.1 } },
      { speakerId: CAT, text: 'ふふ。', dub: { added: true, placeAtSec: 4, levelLikeIndex: 0 } },
    ]
    jsonOf(await editShotsTool.run({ projectId: PROJECT, edits: [{ shotIds: [SHOT_A], dialogue }] }, depsFor(fake)))
    expect(fake.callsTo('PATCH', `/shots/${SHOT_A}`)[0]?.body).toEqual({ dialogue })
  })

  it('食い違う指定（収める長さと切る長さ・足す行に置く時刻が無い・自分を指す音量合わせ・上限外）は送る前に断る', async () => {
    const fake = createFakeApi([])
    const bad = [
      { fitSec: 1, cutSec: 1 },
      { added: true },
      { levelDb: 13 },
      { unknown: 1 },
    ]
    for (const dub of bad) {
      const result = await editShotsTool.run({ projectId: PROJECT, edits: [{ shotIds: [SHOT_A], dialogue: [{ speakerId: CAT, text: 'あ', dub }] }] }, depsFor(fake))
      expect(result.isError).toBe(true)
    }
    const self = await editShotsTool.run(
      { projectId: PROJECT, edits: [{ shotIds: [SHOT_A], dialogue: [{ speakerId: CAT, text: 'あ', dub: { added: true, placeAtSec: 1, levelLikeIndex: 0 } }] }] },
      depsFor(fake),
    )
    expect(textOf(self)).toContain('自分の行')
    expect(fake.calls).toHaveLength(0)
  })
})

describe('edit_character のセリフの声と距離', () => {
  const character = { id: CAT, projectId: PROJECT, name: 'neko', displayName: 'ネコ', speakerNo: 1, dialogueVoiceProfileId: VOICE, dialogueLevelDb: -9.5 }
  const reads = [
    { method: 'GET', path: `/characters/${CAT}`, data: character },
    { method: 'GET', path: `/characters/${CAT}/looks`, data: [] },
    { method: 'GET', path: `/characters/${CAT}/identity-images`, data: [] },
    { method: 'GET', path: `/characters/${CAT}/character-sheet`, data: { job: null } },
  ]

  it('この作品の声をセリフの声にし、距離の既定を送る', async () => {
    const fake = createFakeApi([
      ...reads,
      { method: 'GET', path: `/projects/${PROJECT}/voices`, data: [{ id: VOICE }] },
      { method: 'PATCH', path: `/characters/${CAT}`, data: character },
    ])
    const result = jsonOf(
      await editCharacterTool.run(
        { projectId: PROJECT, characterId: CAT, action: 'update', character: { dialogueVoiceProfileId: VOICE, dialogueLevelDb: -9.5 } },
        depsFor(fake),
      ),
    ) as { character: Record<string, unknown> }
    expect(fake.callsTo('PATCH', `/characters/${CAT}`)[0]?.body).toEqual({ dialogueVoiceProfileId: VOICE, dialogueLevelDb: -9.5 })
    expect(result.character).toMatchObject({ dialogueVoiceProfileId: VOICE, dialogueLevelDb: -9.5 })
  })

  it('別の作品の声・範囲外の距離は送らずに断る', async () => {
    const fake = createFakeApi([...reads, { method: 'GET', path: `/projects/${PROJECT}/voices`, data: [] }])
    const foreign = await editCharacterTool.run(
      { projectId: PROJECT, characterId: CAT, action: 'update', character: { dialogueVoiceProfileId: VOICE } },
      depsFor(fake),
    )
    expect(textOf(foreign)).toContain('この作品に無い声')
    for (const dialogueLevelDb of [-40.5, 12.5]) {
      const out = await editCharacterTool.run(
        { projectId: PROJECT, characterId: CAT, action: 'update', character: { dialogueLevelDb } },
        depsFor(fake),
      )
      expect(out.isError).toBe(true)
    }
    expect(fake.callsTo('PATCH', `/characters/${CAT}`)).toHaveLength(0)
  })
})

describe('design_voice', () => {
  it('説明から声を作って保存し、試し聞きと使い方を返す', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/characters/${CAT}`, data: { id: CAT, projectId: PROJECT } },
      {
        method: 'POST',
        path: `/characters/${CAT}/voices/design`,
        status: 201,
        data: {
          voice: { id: VOICE, name: 'ネコの声', voiceName: 'voice_abc', designedVoice: { description: 'x', gender: 'female', keyLabel: 'key2' } },
          sampleMediaAssetId: ulid('MD1'),
        },
      },
    ])
    const args = { projectId: PROJECT, characterId: CAT, description: 'やわらかい声', gender: 'female', displayName: 'ネコの声' }
    const result = jsonOf(await designVoiceTool.run(args, depsFor(fake))) as Record<string, unknown>
    expect(fake.callsTo('POST', `/characters/${CAT}/voices/design`)[0]?.body).toEqual({ description: 'やわらかい声', gender: 'female', displayName: 'ネコの声' })
    expect(result).toMatchObject({ voiceId: VOICE, name: 'ネコの声', keyLabel: 'key2', sampleMediaAssetId: ulid('MD1') })
    expect(String(result.note)).toContain('dialogueVoiceProfileId')
  })

  it('別の作品のキャラクターには作らない（お金を払わない）', async () => {
    const fake = createFakeApi([{ method: 'GET', path: `/characters/${CAT}`, data: { id: CAT, projectId: OTHER } }])
    const result = await designVoiceTool.run(
      { projectId: PROJECT, characterId: CAT, description: 'x', gender: 'male', displayName: 'n' },
      depsFor(fake),
    )
    expect(result.isError).toBe(true)
    expect(fake.callsTo('POST', /design$/)).toHaveLength(0)
  })
})
