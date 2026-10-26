import { describe, expect, it } from 'vitest'
import { getProjectTool } from '../tools/project.js'
import { listTakesTool } from '../tools/takes.js'
import { createFakeApi, depsFor, jsonOf, ownedShots, takeRow, ulid, WORKSPACE, type Route } from './fake-api.js'

/**
 * 会話劇の状態を MCP から読めるか（ADR-0059〜0061）。get_project はセリフ・話し手の声・Take の音が鳴るか・
 * 書き出しの仕上げ（自動なら実際に使う方）を、list_takes は Take に音があるかと Shot の音の設定を返す。
 */

const PROJECT = ulid('PJ1')
const TALK = ulid('SA1')
const QUIET = ulid('SB1')
const CAT = ulid('CH1')
const MOUSE = ulid('CH2')
const TAKE = ulid('TK1')
const MEDIA = ulid('MD1')

const projectRow = (masteringMode: string | null) => ({
  id: PROJECT,
  workspaceId: WORKSPACE,
  name: '会話劇',
  fps: 24,
  resolution: { width: 1080, height: 1920 },
  aspectRatio: '9:16',
  durationSec: null,
  status: 'planning',
  masteringMode,
})

const shotRow = (id: string, order: number, overrides: Record<string, unknown> = {}) => ({
  id,
  order,
  code: `CUT${String(order + 1)}`,
  startSec: order * 4,
  durationSec: 4,
  description: '',
  mood: null,
  camera: { size: 'medium', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null },
  locationId: null,
  selectedTakeId: null,
  status: 'draft',
  dialogue: [],
  takeAudioVolume: 1,
  takeAudioMuted: null,
  ...overrides,
})

const talkingShot = shotRow(TALK, 0, {
  selectedTakeId: TAKE,
  dialogue: [
    { speakerId: CAT, text: 'ねえ、ネズミくん。', offscreen: false, translation: 'Hey, little mouse.' },
    { speakerId: MOUSE, text: 'なに？', offscreen: true, translation: null },
  ],
  dialogueWarnings: [{ code: 'too_many_lines', message: '長すぎます（10 秒に 3〜4 行まで）' }],
})

const projectRoutes = (masteringMode: string | null, video1: readonly unknown[]): readonly Route[] => [
  { method: 'GET', path: `/projects/${PROJECT}`, data: projectRow(masteringMode) },
  { method: 'GET', path: `/projects/${PROJECT}/script`, status: 404, data: 'なし' },
  { method: 'GET', path: `/projects/${PROJECT}/shots`, data: [talkingShot, shotRow(QUIET, 1, { selectedTakeId: ulid('TK2') })] },
  { method: 'GET', path: `/projects/${PROJECT}/music-tracks`, data: [] },
  {
    method: 'GET',
    path: `/projects/${PROJECT}/characters`,
    data: [
      { id: CAT, name: 'neko', displayName: 'ネコ', speechName: 'The cat', voiceDescription: 'a soft, sly voice' },
      { id: MOUSE, name: 'nezumi', displayName: 'ネズミ', speechName: null, voiceDescription: null },
    ],
  },
  { method: 'GET', path: `/projects/${PROJECT}/locations`, data: [] },
  { method: 'GET', path: `/projects/${PROJECT}/shot-posters`, data: [] },
  { method: 'GET', path: `/projects/${PROJECT}/transitions`, data: [] },
  { method: 'GET', path: `/projects/${PROJECT}/timeline`, data: { durationSec: 8, video1 } },
  { method: 'GET', path: /^\/shots\/[^/]+\/characters$/, data: [] },
]

type ProjectView = {
  project: Record<string, unknown>
  characters: Record<string, unknown>[]
  shots: Record<string, unknown>[]
}

describe('get_project の会話劇', () => {
  it('セリフを話し手の名前つきで、警告と Take の音が鳴るかを Shot ごとに返す', async () => {
    const video1 = [
      { shotId: TALK, startSec: 0, durationSec: 4, mediaUrl: 'u', inSec: 0, audio: { volume: 1 } },
      { shotId: QUIET, startSec: 4, durationSec: 4, mediaUrl: 'u', inSec: 0 },
    ]
    const result = jsonOf(await getProjectTool.run({ projectId: PROJECT }, depsFor(createFakeApi(projectRoutes(null, video1))))) as ProjectView

    expect(result.shots[0]).toMatchObject({
      dialogue: [
        { speaker: 'ネコ', speakerId: CAT, text: 'ねえ、ネズミくん。', translation: 'Hey, little mouse.' },
        { speaker: 'ネズミ', speakerId: MOUSE, text: 'なに？', offscreen: true },
      ],
      dialogueWarnings: ['長すぎます（10 秒に 3〜4 行まで）'],
      takeAudioPlays: true,
    })
    expect(result.shots[0]?.dialogue).toEqual([
      expect.not.objectContaining({ offscreen: expect.anything() as unknown }),
      expect.not.objectContaining({ translation: expect.anything() as unknown }),
    ])
    // セリフの無い Shot は dialogue を出さず、採用 Take の音は鳴らない
    expect(result.shots[1]).toMatchObject({ takeAudioPlays: false })
    expect(result.shots[1]).not.toHaveProperty('dialogue')
    expect(result.shots[1]).not.toHaveProperty('dialogueWarnings')
  })

  it('話し手の呼び名と声の説明を返し、無ければ null にする（Take を作る前に足りないと分かる）', async () => {
    const result = jsonOf(await getProjectTool.run({ projectId: PROJECT }, depsFor(createFakeApi(projectRoutes(null, []))))) as ProjectView
    expect(result.characters).toEqual([
      { id: CAT, name: 'neko', displayName: 'ネコ', speechName: 'The cat', voiceDescription: 'a soft, sly voice' },
      { id: MOUSE, name: 'nezumi', displayName: 'ネズミ', speechName: null, voiceDescription: null },
    ])
  })

  it('仕上げが自動なら、Take の音が鳴る Shot があるかで実際に使う方を返す', async () => {
    const plays = [{ shotId: TALK, startSec: 0, durationSec: 4, mediaUrl: 'u', inSec: 0, audio: { volume: 1 } }]
    const auto = jsonOf(await getProjectTool.run({ projectId: PROJECT }, depsFor(createFakeApi(projectRoutes(null, plays))))) as ProjectView
    expect(auto.project).toMatchObject({ effectiveMasteringMode: 'peak' })
    expect(auto.project).not.toHaveProperty('masteringMode')

    const silent = jsonOf(await getProjectTool.run({ projectId: PROJECT }, depsFor(createFakeApi(projectRoutes(null, []))))) as ProjectView
    expect(silent.project).toMatchObject({ effectiveMasteringMode: 'loudnorm' })

    // 選んであれば、鳴る Shot があってもその値
    const chosen = jsonOf(
      await getProjectTool.run({ projectId: PROJECT }, depsFor(createFakeApi(projectRoutes('loudnorm', plays)))),
    ) as ProjectView
    expect(chosen.project).toMatchObject({ masteringMode: 'loudnorm', effectiveMasteringMode: 'loudnorm' })
  })
})

describe('get_project でタイムラインが組めないとき', () => {
  const withTimeline = (masteringMode: string | null, timeline: Route): readonly Route[] =>
    projectRoutes(masteringMode, []).map((r) => (r.path === `/projects/${PROJECT}/timeline` ? timeline : r))

  it.each([422, 500])('タイムラインが %d でも残りを返し、分からない値は null と注記で残す', async (status) => {
    const timeline: Route = { method: 'GET', path: `/projects/${PROJECT}/timeline`, status, data: '組めません' }
    const result = jsonOf(
      await getProjectTool.run({ projectId: PROJECT }, depsFor(createFakeApi(withTimeline(null, timeline)))),
    ) as ProjectView & { notes?: string[] }

    // 「loudnorm」と黙って言わない
    expect(result.project).toMatchObject({ effectiveMasteringMode: null })
    expect(result.shots[0]).toMatchObject({ takeAudioPlays: null, dialogue: expect.any(Array) as unknown })
    expect(result.shots).toHaveLength(2)
    expect(result.notes?.join('')).toContain('タイムライン')
  })

  it('仕上げを選んであれば、タイムラインが組めなくてもその値を返す', async () => {
    const timeline: Route = { method: 'GET', path: `/projects/${PROJECT}/timeline`, status: 500, data: 'x' }
    const result = jsonOf(
      await getProjectTool.run({ projectId: PROJECT }, depsFor(createFakeApi(withTimeline('peak', timeline)))),
    ) as ProjectView
    expect(result.project).toMatchObject({ masteringMode: 'peak', effectiveMasteringMode: 'peak' })
    expect(result.shots[0]).toMatchObject({ takeAudioPlays: null })
  })
})

describe('list_takes の音', () => {
  const shotRoute = (overrides: Record<string, unknown>): Route => ({
    method: 'GET',
    path: `/shots/${TALK}`,
    data: shotRow(TALK, 0, { selectedTakeId: TAKE, ...overrides }),
  })
  const takesRoute: Route = { method: 'GET', path: `/shots/${TALK}/takes`, data: [{ ...takeRow(TAKE, null, null), mediaAssetId: MEDIA }] }
  const mediaRoute = (probe: unknown): Route => ({
    method: 'GET',
    path: `/media/${MEDIA}`,
    data: { id: MEDIA, kind: 'video', mimeType: 'video/mp4', lastFrameAssetId: null, probe },
  })

  type TakesView = { takeAudio: Record<string, unknown>; takes: Record<string, unknown>[] }

  it('Shot の音の設定を返す。自動ならセリフのある Shot は鳴らし、無い Shot は消す', async () => {
    const withLines = createFakeApi([
      ownedShots(PROJECT, [TALK]),
      shotRoute({ dialogue: [{ speakerId: CAT, text: 'ねえ', offscreen: false, translation: null }] }),
      takesRoute,
    ])
    const talking = jsonOf(await listTakesTool.run({ projectId: PROJECT, shotId: TALK }, depsFor(withLines))) as TakesView
    expect(talking.takeAudio).toEqual({ volume: 1, muted: false, auto: true })

    const without = createFakeApi([ownedShots(PROJECT, [TALK]), shotRoute({ takeAudioVolume: 0.5 }), takesRoute])
    const quiet = jsonOf(await listTakesTool.run({ projectId: PROJECT, shotId: TALK }, depsFor(without))) as TakesView
    expect(quiet.takeAudio).toEqual({ volume: 0.5, muted: true, auto: true })

    const forced = createFakeApi([ownedShots(PROJECT, [TALK]), shotRoute({ takeAudioMuted: false }), takesRoute])
    const on = jsonOf(await listTakesTool.run({ projectId: PROJECT, shotId: TALK }, depsFor(forced))) as TakesView
    expect(on.takeAudio).toEqual({ volume: 1, muted: false, auto: false })
  })

  it('includeAudio なら Take ごとに音のトラックがあるかを返す（まだ調べていなければ null）', async () => {
    const probed = createFakeApi([ownedShots(PROJECT, [TALK]), shotRoute({}), takesRoute, mediaRoute({ hasAudio: true })])
    const result = jsonOf(await listTakesTool.run({ projectId: PROJECT, shotId: TALK, includeAudio: true }, depsFor(probed))) as TakesView
    expect(result.takes[0]).toMatchObject({ hasAudio: true })
    expect(result.takes[0]).not.toHaveProperty('lastFrameAssetId')

    const pending = createFakeApi([ownedShots(PROJECT, [TALK]), shotRoute({}), takesRoute, mediaRoute(null)])
    const unknown = jsonOf(await listTakesTool.run({ projectId: PROJECT, shotId: TALK, includeAudio: true }, depsFor(pending))) as TakesView
    expect(unknown.takes[0]).toMatchObject({ hasAudio: null })
  })

  it('includeAudio を付けなければ素材を引かず、hasAudio も返さない', async () => {
    const fake = createFakeApi([ownedShots(PROJECT, [TALK]), shotRoute({}), takesRoute])
    const result = jsonOf(await listTakesTool.run({ projectId: PROJECT, shotId: TALK }, depsFor(fake))) as TakesView
    expect(result.takes[0]).not.toHaveProperty('hasAudio')
    expect(fake.callsTo('GET', /^\/media\//)).toHaveLength(0)
  })
})
