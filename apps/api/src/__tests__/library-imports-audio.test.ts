import { OpenAPIHono } from '@hono/zod-openapi'
import {
  MediaAssetId as MediaAssetIdSchema,
  MusicTrackId as MusicTrackIdSchema,
  SFX_IMPORTED_FROM_KEY,
  SFX_SEEDS_USED_KEY,
  newId,
  type Project,
} from '@ixa/domain'
import {
  createInMemoryBrandAssetRepository,
  createInMemoryCharacterLookRepository,
  createInMemoryCharacterRepository,
  createInMemoryLocationRepository,
  createInMemorySfxJobRepository,
  createInMemoryVoiceProfileRepository,
  type InMemoryCharacterRepository,
} from '@ixa/generation/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { libraryImportRoutes } from '../routes/library-imports.js'
import { aProject } from './fixtures.js'
import {
  createInMemoryMusicAnalysisRepository,
  type InMemoryMusicAnalysisRepository,
} from './in-memory-music-analysis-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import {
  createInMemoryMusicTrackRepository,
  type InMemoryMusicTrackRepository,
} from './in-memory-timeline-repositories.js'

/**
 * 声・楽曲・効果音もほかの作品から取り込む（ADR-0053。制作者 2026-10-19「素材ツリーにある各種項目の素材を
 * 他のプロジェクトから簡単にコピーできるといいなぁ。現にいま、戦子ちゃんにある声素材が欲しいと思ってしまった」）。
 * 設定は複製し、音のファイルは同じものを指す。書く前に全部を確かめ、1 件でも取り込めなければ何も作らない。
 */

type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }
type ImportBody = {
  success: true
  data: {
    voices: { id: string; projectId: string; name: string; characterId: string | null; textStyleId: string | null }[]
    musicTracks: { id: string; projectId: string; mediaAssetId: string; isMaster: boolean; endSec: number | null }[]
    sfxSounds: { sfxJobId: string; mediaAssetId: string }[]
  }
}

let source: Project
let target: Project
let elsewhere: Project
let characters: InMemoryCharacterRepository
let voices: ReturnType<typeof createInMemoryVoiceProfileRepository>
let musicTracks: InMemoryMusicTrackRepository
let musicAnalyses: InMemoryMusicAnalysisRepository
let sfxJobs: ReturnType<typeof createInMemorySfxJobRepository>
let app: OpenAPIHono

const post = (projectId: string, payload: unknown) =>
  app.request(`/projects/${projectId}/library-imports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

beforeEach(() => {
  source = aProject({ name: '進め！戦子ちゃん！4' })
  target = aProject({ workspaceId: source.workspaceId, name: '戦子のタイムトラベル（宣伝）' })
  elsewhere = aProject({ name: '別のワークスペース' })
  characters = createInMemoryCharacterRepository()
  voices = createInMemoryVoiceProfileRepository()
  musicTracks = createInMemoryMusicTrackRepository()
  musicAnalyses = createInMemoryMusicAnalysisRepository()
  sfxJobs = createInMemorySfxJobRepository()
  app = new OpenAPIHono({ defaultHook: validationHook })
  app.route(
    '/',
    libraryImportRoutes({
      projects: createInMemoryProjectRepository([source, target, elsewhere]),
      characters,
      looks: createInMemoryCharacterLookRepository(),
      locations: createInMemoryLocationRepository(),
      brandAssets: createInMemoryBrandAssetRepository(),
      voices,
      musicTracks,
      musicAnalyses,
      sfxJobs,
    }),
  )
  registerErrorHandlers(app, createLogger('silent'))
})

const senkoVoice = (owner: Project = source) =>
  voices.create({
    projectId: owner.id,
    name: '戦子',
    tool: 'gemini_api',
    model: 'gemini-3.8-flash-tts',
    voiceName: 'Kore',
    styleNote: '元気な少女の声',
    speed: 1.1,
  })

/** 1 回で 2 本作った効果音（1 本目だけ段に置いた）。 */
const swordClash = async (owner: Project = source) => {
  const job = await sfxJobs.create({
    projectId: owner.id,
    tool: 'stable_audio',
    model: null,
    spec: { cue: { startSec: 3.75, durationSec: 1.5, prompt: 'sword clash', volume: 0.8 }, count: 2, seed: 10 },
  })
  const sounds = [newId(MediaAssetIdSchema), newId(MediaAssetIdSchema)] as const
  await sfxJobs.markSucceeded(job.id, {
    mediaAssetIds: sounds,
    timelineClipId: null,
    providerRecord: { [SFX_SEEDS_USED_KEY]: [10, 12] },
  })
  return { job, sounds }
}

describe('POST /projects/{projectId}/library-imports（声・楽曲・効果音）', () => {
  it('声の設定を複製する（テロップの見た目は外し、取り込んでいないキャラクターへの結び付きも外す）', async () => {
    const character = await characters.create({
      workspaceId: source.workspaceId, projectId: source.id, name: 'senko', displayName: '戦子',
    })
    const original = await voices.update((await senkoVoice()).id, { characterId: character.id })

    const res = await post(target.id, { voiceIds: [original.id] })

    expect(res.status).toBe(201)
    const [copy] = ((await res.json()) as ImportBody).data.voices
    expect(copy).toMatchObject({ projectId: target.id, name: '戦子', characterId: null, textStyleId: null })
    expect(copy?.id).not.toBe(original.id)
    expect(await voices.findByProject(target.id)).toEqual([
      expect.objectContaining({ tool: 'gemini_api', voiceName: 'Kore', styleNote: '元気な少女の声', speed: 1.1 }),
    ])
  })

  it('同じ取り込みでキャラクターも写せば、写した方のキャラクターの声になる', async () => {
    const character = await characters.create({
      workspaceId: source.workspaceId, projectId: source.id, name: 'senko', displayName: '戦子',
    })
    const original = await voices.update((await senkoVoice()).id, { characterId: character.id })

    const res = await post(target.id, { characterIds: [character.id], voiceIds: [original.id] })

    expect(res.status).toBe(201)
    const [copiedCharacter] = await characters.findByProject(target.id)
    expect(((await res.json()) as ImportBody).data.voices[0]?.characterId).toBe(copiedCharacter?.id)
  })

  it('取り込み先に同じ名前の声があれば名前をずらす（作品の中で声の名前は一意）', async () => {
    await senkoVoice(target)
    const original = await senkoVoice()

    const res = await post(target.id, { voiceIds: [original.id] })

    expect(res.status).toBe(201)
    expect(((await res.json()) as ImportBody).data.voices.map((voice) => voice.name)).toEqual(['戦子（2）'])
  })

  it('楽曲は同じ音を指して複製し、解析も写す。取り込み先ではマスターにしない', async () => {
    await musicTracks.create({ projectId: target.id, mediaAssetId: newId(MediaAssetIdSchema), title: '宣伝の曲', isMaster: true })
    const song = await musicTracks.create({
      projectId: source.id, mediaAssetId: newId(MediaAssetIdSchema), title: '進め！戦子ちゃん！', isMaster: true,
      offsetSec: 1.5, fadeOutSec: 2, endSec: 95.25,
    })
    await musicAnalyses.create({
      musicTrackId: song.id, analyzerVersion: 'librosa-v1', durationSec: 100, bpm: 128, bpmConfidence: 0.9,
      beats: [0.5], downbeats: [0.5], sections: [], energyCurve: { hopSec: 0.5, values: [] }, onsets: [], drops: [],
      waveformPeaksKey: 'peaks/a.json',
    })

    const res = await post(target.id, { musicTrackIds: [song.id] })

    expect(res.status).toBe(201)
    const [copy] = ((await res.json()) as ImportBody).data.musicTracks
    expect(copy).toMatchObject({ projectId: target.id, mediaAssetId: song.mediaAssetId, isMaster: false, endSec: 95.25 })
    expect(copy?.id).not.toBe(song.id)
    const copiedAnalysis = await musicAnalyses.findByTrack(MusicTrackIdSchema.parse(copy?.id))
    expect(copiedAnalysis).toMatchObject({ bpm: 128, analyzerVersion: 'librosa-v1' })
    // 元の曲はマスターのまま（取り込みで元は変わらない）。
    expect((await musicTracks.findById(song.id))?.isMaster).toBe(true)
  })

  it('効果音は選んだ 1 本を、取り込み先の「置いていない候補」にする（段には置かない）', async () => {
    const { job, sounds } = await swordClash()

    const res = await post(target.id, { sfxSounds: [{ sfxJobId: job.id, mediaAssetId: sounds[1] }] })

    expect(res.status).toBe(201)
    const [imported] = ((await res.json()) as ImportBody).data.sfxSounds
    expect(imported?.mediaAssetId).toBe(sounds[1])
    const [row] = await sfxJobs.findRecentByProject(target.id, 10)
    expect(row).toMatchObject({
      id: imported?.sfxJobId,
      status: 'succeeded',
      mediaAssetIds: [sounds[1]],
      timelineClipId: null,
      spec: { cue: { prompt: 'sword clash' }, count: 1, seed: 12 },
      providerRecord: { [SFX_IMPORTED_FROM_KEY]: { projectId: source.id, sfxJobId: job.id } },
    })
    // 作っている途中に見える行は作らない。
    expect(await sfxJobs.findActiveByProject(target.id)).toEqual([])
  })

  it('別のワークスペースのもの・無いもの・ジョブに無い音は断り、何も作らない', async () => {
    const foreignVoice = await senkoVoice(elsewhere)
    const ownVoice = await senkoVoice()
    const { job } = await swordClash()

    const foreign = await post(target.id, { voiceIds: [ownVoice.id, foreignVoice.id] })
    const missing = await post(target.id, { musicTrackIds: [newId(MusicTrackIdSchema)] })
    const strayAsset = await post(target.id, { sfxSounds: [{ sfxJobId: job.id, mediaAssetId: newId(MediaAssetIdSchema) }] })

    expect(foreign.status).toBe(422)
    expect(((await foreign.json()) as ErrorBody).fields?.voiceIds).toBeDefined()
    expect(missing.status).toBe(422)
    expect(((await missing.json()) as ErrorBody).fields?.musicTrackIds).toBeDefined()
    expect(strayAsset.status).toBe(422)
    expect(((await strayAsset.json()) as ErrorBody).fields?.sfxSounds).toBeDefined()
    expect(await voices.findByProject(target.id)).toEqual([])
    expect(await musicTracks.findByProject(target.id)).toEqual([])
    expect(await sfxJobs.findRecentByProject(target.id, 10)).toEqual([])
  })

  it('1 種類 50 件までしか受けない・形の違う ID は受けない', async () => {
    // 実在する声を 51 回（無い ID だと「無い」で断られ、上限の検査が素通りしても気づけない）。
    const voice = await senkoVoice()
    const tooMany = Array.from({ length: 51 }, () => voice.id)
    const clash = await swordClash()

    const fieldsOf = async (payload: unknown): Promise<readonly string[]> => {
      const res = await post(target.id, payload)
      expect(res.status).toBe(422)
      return Object.keys(((await res.json()) as ErrorBody).fields ?? {})
    }

    // 「何も選んでいない」と区別するため、どの欄で断ったかまで見る。
    expect(await fieldsOf({ voiceIds: tooMany })).toEqual([expect.stringMatching(/^voiceIds/)])
    expect(await fieldsOf({ musicTrackIds: ['not-an-id'] })).toEqual([expect.stringMatching(/^musicTrackIds/)])
    expect(
      await fieldsOf({ sfxSounds: [{ sfxJobId: 'not-an-id', mediaAssetId: newId(MediaAssetIdSchema) }] }),
    ).toEqual([expect.stringMatching(/^sfxSounds/)])
    expect(
      // 実在する音に知らない欄を添える（打ち間違いの欄を黙って捨てない）。
      await fieldsOf({ sfxSounds: [{ sfxJobId: clash.job.id, mediaAssetId: clash.sounds[0], extra: 1 }] }),
    ).toEqual([expect.stringMatching(/^sfxSounds/)])
    expect(await voices.findByProject(target.id)).toEqual([])
    expect(await sfxJobs.findRecentByProject(target.id, 10)).toEqual([])
  })
})
