import {
  MusicAnalysis as MusicAnalysisSchema,
  MusicAnalysisId as MusicAnalysisIdSchema,
  MusicTrack as MusicTrackSchema,
  MusicTrackId as MusicTrackIdSchema,
  ShotId as ShotIdSchema,
  TakeId as TakeIdSchema,
  newId,
  type MediaAsset,
  type MusicAnalysis,
  type MusicTrack,
  type Project,
  type Shot,
  type Take,
} from '@ixa/domain'
import { OpenAPIHono } from '@hono/zod-openapi'
import { aShot, aTake } from '@ixa/generation/testing'
import { createMemoryStorage } from '@ixa/storage'
import { describe, expect, it } from 'vitest'
import {
  shotCompareRoutes,
  type ShotCompareResponse,
  type ShotCompareRoutesDeps,
} from '../routes/shot-compare.js'
import { validationHook } from '../errors.js'
import { timelineRoutes } from '../routes/timeline.js'
import { aProject } from './fixtures.js'
import { createInMemoryMusicAnalysisRepository } from './in-memory-music-analysis-repository.js'
import {
  aMediaAsset,
  createInMemoryMusicTrackRepository,
} from './in-memory-timeline-repositories.js'
import { timelineDeps } from './timeline-deps.js'

/**
 * `GET /shots/:shotId/compare` の検証（P61-2）。
 * 実 DB / 実ストレージには接続しない。
 *
 * ここで守りたいのは 3 つ。
 * 1. **書き出しと同じ窓**（`inSec` は `shot.sourceInSec`）で切り出すこと
 * 2. **音は A だけ**に入ること（二重に鳴らない）
 * 3. 比較できない理由と拍が無い理由を**それぞれ別の値**として返すこと（L-015）
 */

type Ok<T> = { success: true; data: T }

const SONG_SEC = 116

const anAudioAsset = (project: Project): MediaAsset =>
  aMediaAsset({
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'audio',
    storageKey: 'media/ws/song/original.wav',
    mimeType: 'audio/wav',
    probe: {
      durationSec: SONG_SEC,
      width: null,
      height: null,
      fps: null,
      hasAudio: true,
      codec: 'pcm_s16le',
    },
  })

const aMusicTrack = (project: Project, mediaAssetId: MediaAsset['id']): MusicTrack =>
  MusicTrackSchema.parse({
    id: newId(MusicTrackIdSchema),
    projectId: project.id,
    mediaAssetId,
    title: 'iXA CUP',
    isMaster: true,
    offsetSec: 0,
    volume: 1,
  })

const anAnalysis = (
  musicTrackId: MusicTrack['id'],
  beats: readonly number[] = [0, 0.5, 1, 1.5, 2],
): MusicAnalysis =>
  MusicAnalysisSchema.parse({
    id: newId(MusicAnalysisIdSchema),
    musicTrackId,
    analyzerVersion: 'librosa-v1',
    durationSec: SONG_SEC,
    bpm: 120,
    bpmConfidence: 0.92,
    beats: [...beats],
    downbeats: [0, 2],
    sections: [{ start: 0, end: SONG_SEC, label: 'intro', energy: 0.4 }],
    energyCurve: { hopSec: 0.05, values: [0, 0.5, 1] },
    onsets: [0.01],
    drops: [32.5],
    waveformPeaksKey: 'music/p/t/peaks.json',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  })

type SceneOptions = {
  /** 楽曲を登録するか。false なら `no_track` になる。 */
  readonly withTrack?: boolean
  /** 解析を積むか。false なら `no_analysis` になる。 */
  readonly withAnalysis?: boolean
  readonly beats?: readonly number[]
  /** B の Take のメディアを登録するか。false なら `b_media_unresolved` になる。 */
  readonly withMediaB?: boolean
  /** A の Take のメディアを登録するか。false なら `a_media_unresolved` になる。 */
  readonly withMediaA?: boolean
  readonly shot?: Partial<Shot>
  /** A / B の素材の長さ（probe）。省略は probe なし。 */
  readonly probeSecA?: number
  readonly probeSecB?: number
}

type Scene = {
  readonly deps: ShotCompareRoutesDeps
  readonly project: Project
  readonly shot: Shot
  readonly otherShot: Shot
  readonly takeA: Take
  readonly takeB: Take
  readonly otherShotTake: Take
  readonly assetA: MediaAsset
  readonly assetB: MediaAsset
  readonly songAsset: MediaAsset
}

/**
 * Shot 1 本と Take 2 本、別の Shot、曲 1 本を用意する。
 * **素材はすべて別の値にする。** 使い回すと「出ないはず」の確認が偶然の一致で濁る（L-014）。
 */
const scene = (options: SceneOptions = {}): Scene => {
  const project = aProject()
  const shot = aShot(project.id, {
    code: 'shot_010',
    startSec: 40,
    durationSec: 4,
    sourceInSec: 1.5,
    ...options.shot,
  })
  const otherShot = aShot(project.id, { code: 'shot_011', startSec: 44, durationSec: 4 })

  const probeOf = (sec: number | undefined) =>
    sec === undefined
      ? null
      : { durationSec: sec, width: 1280, height: 720, fps: 24, hasAudio: false, codec: 'h264' }
  const assetA = aMediaAsset({
    workspaceId: project.workspaceId,
    projectId: project.id,
    storageKey: 'media/ws/take-a/original.mp4',
    probe: probeOf(options.probeSecA),
  })
  const assetB = aMediaAsset({
    workspaceId: project.workspaceId,
    projectId: project.id,
    storageKey: 'media/ws/take-b/original.mp4',
    probe: probeOf(options.probeSecB),
  })
  const otherAsset = aMediaAsset({
    workspaceId: project.workspaceId,
    projectId: project.id,
    storageKey: 'media/ws/take-other/original.mp4',
  })
  const songAsset = anAudioAsset(project)

  const takeA = aTake(shot, 'a'.repeat(64), { mediaAssetId: assetA.id, index: 1 })
  const takeB = aTake(shot, 'b'.repeat(64), { mediaAssetId: assetB.id, index: 2 })
  const otherShotTake = aTake(otherShot, 'c'.repeat(64), { mediaAssetId: otherAsset.id })

  const track = aMusicTrack(project, songAsset.id)
  const musicTracks = createInMemoryMusicTrackRepository(options.withTrack === false ? [] : [track])
  const musicAnalyses = createInMemoryMusicAnalysisRepository(
    options.withTrack === false || options.withAnalysis === false
      ? []
      : [anAnalysis(track.id, options.beats)],
  )

  const mediaAssets = [
    ...(options.withMediaA === false ? [] : [assetA]),
    ...(options.withMediaB === false ? [] : [assetB]),
    otherAsset,
    songAsset,
  ]

  const deps: ShotCompareRoutesDeps = {
    ...timelineDeps({
      project,
      shots: [shot, otherShot],
      takes: [takeA, takeB, otherShotTake],
      mediaAssets,
      clips: [],
    }),
    musicTracks,
    musicAnalyses,
    storage: createMemoryStorage(),
  }

  return { deps, project, shot, otherShot, takeA, takeB, otherShotTake, assetA, assetB, songAsset }
}

const compare = async (s: Scene, query: string) => {
  const response = await shotCompareRoutes(s.deps).request(`/shots/${s.shot.id}/compare?${query}`)
  const body = (await response.json()) as Ok<ShotCompareResponse>
  return { response, body }
}

describe('GET /shots/:shotId/compare — 書き出しと同じ窓で切り出す', () => {
  it('inSec に shot.sourceInSec がそのまま入る（ADR-0011）', async () => {
    const s = scene()
    const { body } = await compare(s, `a=${s.takeA.id}&b=${s.takeB.id}`)

    expect(body.data.a.document.video1[0]?.inSec).toBe(s.shot.sourceInSec)
    expect(body.data.b?.document.video1[0]?.inSec).toBe(s.shot.sourceInSec)
  })

  it('Shot は本当の startSec の位置に置かれる', async () => {
    const s = scene()
    const { body } = await compare(s, `a=${s.takeA.id}`)

    expect(body.data.a.document.video1[0]?.startSec).toBe(40)
    expect(body.data.a.document.video1[0]?.durationSec).toBe(4)
    expect(body.data.shot).toEqual({ startSec: 40, durationSec: 4, sourceInSec: 1.5 })
  })

  it('この Shot 1 本だけを載せる（他の Shot は載らない）', async () => {
    const s = scene()
    const { body } = await compare(s, `a=${s.takeA.id}&b=${s.takeB.id}`)

    expect(body.data.a.document.video1).toHaveLength(1)
    expect(body.data.a.document.video1[0]?.shotId).toBe(s.shot.id)
  })

  /** 尺に合わせる Shot では、A と B は**それぞれの Take の長さ**で速度が決まる（ADR-0026）。 */
  it('fit の Shot は A と B で別の速度になる', async () => {
    const s = scene({ shot: { timing: 'fit', sourceInSec: 0 }, probeSecA: 6, probeSecB: 2 })
    const { body } = await compare(s, `a=${s.takeA.id}&b=${s.takeB.id}`)

    expect(body.data.a.document.video1[0]?.playbackRate).toBeCloseTo(1.5, 9)
    expect(body.data.b?.document.video1[0]?.playbackRate).toBeCloseTo(0.5, 9)
  })

  it('A と B はそれぞれの Take のメディアを映す', async () => {
    const s = scene()
    const { body } = await compare(s, `a=${s.takeA.id}&b=${s.takeB.id}`)

    expect(body.data.a.document.video1[0]?.mediaUrl).toContain(s.assetA.storageKey)
    expect(body.data.b?.document.video1[0]?.mediaUrl).toContain(s.assetB.storageKey)
  })

  it('メディア URL は都度発行の署名付き URL（DB には保存しない）', async () => {
    const s = scene()
    const { body } = await compare(s, `a=${s.takeA.id}`)

    expect(body.data.a.document.video1[0]?.mediaUrl).toBe(
      `memory://${s.assetA.storageKey}?op=get&expires=3600`,
    )
  })

  it('タイムラインは曲の長さまで伸びる（Shot だけの尺にならない）', async () => {
    const s = scene()
    const { body } = await compare(s, `a=${s.takeA.id}`)

    expect(body.data.a.document.durationSec).toBe(SONG_SEC)
  })
})

describe('GET /shots/:shotId/compare — 音は A だけ', () => {
  it('A には曲全体の音楽トラックが入る', async () => {
    const s = scene()
    const { body } = await compare(s, `a=${s.takeA.id}&b=${s.takeB.id}`)

    expect(body.data.a.document.audio).toHaveLength(1)
    expect(body.data.a.document.audio[0]?.mediaUrl).toContain(s.songAsset.storageKey)
    expect(body.data.a.document.audio[0]?.durationSec).toBe(SONG_SEC)
  })

  it('B には音を入れない（二重に鳴らない）', async () => {
    const s = scene()
    const { body } = await compare(s, `a=${s.takeA.id}&b=${s.takeB.id}`)

    expect(body.data.b?.document.audio).toEqual([])
  })
})

describe('GET /shots/:shotId/compare — 比較できない理由を混ぜない', () => {
  it('B を指定しないときは b_not_requested', async () => {
    const s = scene()
    const { body } = await compare(s, `a=${s.takeA.id}`)

    expect(body.data.b).toBeNull()
    expect(body.data.reason).toBe('b_not_requested')
  })

  it('A と同じ Take を B に指定したときは b_same_as_a', async () => {
    const s = scene()
    const { body } = await compare(s, `a=${s.takeA.id}&b=${s.takeA.id}`)

    expect(body.data.b).toBeNull()
    expect(body.data.reason).toBe('b_same_as_a')
  })

  it('B の Take が存在しないときは b_not_found', async () => {
    const s = scene()
    const { body } = await compare(s, `a=${s.takeA.id}&b=${newId(TakeIdSchema)}`)

    expect(body.data.b).toBeNull()
    expect(body.data.reason).toBe('b_not_found')
  })

  it('別の Shot の Take を B に指定しても b_not_found（黙って並べない）', async () => {
    const s = scene()
    const { body } = await compare(s, `a=${s.takeA.id}&b=${s.otherShotTake.id}`)

    expect(body.data.b).toBeNull()
    expect(body.data.reason).toBe('b_not_found')
  })

  it('B のメディアを解決できないときは b_media_unresolved（b_not_found と分ける）', async () => {
    const s = scene({ withMediaB: false })
    const { body } = await compare(s, `a=${s.takeA.id}&b=${s.takeB.id}`)

    expect(body.data.b).toBeNull()
    expect(body.data.reason).toBe('b_media_unresolved')
  })

  it('A のメディアを解決できないときは a_media_unresolved を最優先で返す', async () => {
    const s = scene({ withMediaA: false })
    const { body } = await compare(s, `a=${s.takeA.id}`)

    // 絵が 1 枚も無い document をそのまま渡すと「Shot が 0 件」に見えてしまう。
    expect(body.data.a.document.video1).toEqual([])
    expect(body.data.reason).toBe('a_media_unresolved')
  })

  it('両方そろっているときは reason が null', async () => {
    const s = scene()
    const { body } = await compare(s, `a=${s.takeA.id}&b=${s.takeB.id}`)

    expect(body.data.reason).toBeNull()
    expect(body.data.b?.takeId).toBe(s.takeB.id)
  })
})

describe('GET /shots/:shotId/compare — 拍が無い理由を混ぜない', () => {
  it('解析があれば曲全体の拍を絶対秒で返す', async () => {
    const s = scene({ beats: [0, 0.5, 40.25, 41, 100] })
    const { body } = await compare(s, `a=${s.takeA.id}`)

    expect(body.data.beats).toEqual([0, 0.5, 40.25, 41, 100])
    expect(body.data.beatState).toBe('available')
  })

  /**
   * **楽曲の選び方は `@ixa/domain` の `pickMasterTrack` 1 箇所だけが持つ。**
   * ここが先頭を採る実装に戻ると、同じ Project でも画面ごとに違う曲の拍で
   * 色が付く（タイムラインは master、比較は先頭）。規則を寄せた意味が消えるので、
   * **この口が本当にその規則を通っていること**を固定する（lessons L-016）。
   */
  it('楽曲が複数あってもマスター音源の解析を使う', async () => {
    const s = scene()
    const project = s.project
    const decoy = MusicTrackSchema.parse({
      id: newId(MusicTrackIdSchema),
      projectId: project.id,
      mediaAssetId: s.songAsset.id,
      title: 'ダミー（マスターではない）',
      isMaster: false,
      offsetSec: 0,
      volume: 1,
    })
    const master = MusicTrackSchema.parse({
      id: newId(MusicTrackIdSchema),
      projectId: project.id,
      mediaAssetId: s.songAsset.id,
      title: 'マスター',
      isMaster: true,
      offsetSec: 0,
      volume: 1,
    })
    // **マスターを後ろに置く。** 先頭を採る実装なら decoy の拍が返る。
    const deps: ShotCompareRoutesDeps = {
      ...s.deps,
      musicTracks: createInMemoryMusicTrackRepository([decoy, master]),
      musicAnalyses: createInMemoryMusicAnalysisRepository([
        anAnalysis(decoy.id, [9, 9.5]),
        anAnalysis(master.id, [1, 2, 3]),
      ]),
    }
    const { body } = await compare({ ...s, deps }, `a=${s.takeA.id}`)

    expect(body.data.beats).toEqual([1, 2, 3])
  })

  it('楽曲が無いときは no_track', async () => {
    const s = scene({ withTrack: false })
    const { body } = await compare(s, `a=${s.takeA.id}`)

    expect(body.data.beats).toEqual([])
    expect(body.data.beatState).toBe('no_track')
  })

  it('解析がまだ無いときは no_analysis', async () => {
    const s = scene({ withAnalysis: false })
    const { body } = await compare(s, `a=${s.takeA.id}`)

    expect(body.data.beats).toEqual([])
    expect(body.data.beatState).toBe('no_analysis')
  })

  it('解析はあるが拍が 0 件のときは no_beats', async () => {
    const s = scene({ beats: [] })
    const { body } = await compare(s, `a=${s.takeA.id}`)

    expect(body.data.beats).toEqual([])
    expect(body.data.beatState).toBe('no_beats')
  })

  it('拍が無くても A の document は返る（比較そのものは成立する）', async () => {
    const s = scene({ withTrack: false })
    const { body } = await compare(s, `a=${s.takeA.id}&b=${s.takeB.id}`)

    expect(body.data.a.document.video1).toHaveLength(1)
    expect(body.data.reason).toBeNull()
  })
})

describe('GET /shots/:shotId/compare — 見つからないもの', () => {
  it('Shot が無ければ 404', async () => {
    const s = scene()
    const response = await shotCompareRoutes(s.deps).request(
      `/shots/${newId(ShotIdSchema)}/compare?a=${s.takeA.id}`,
    )

    expect(response.status).toBe(404)
  })

  it('A の Take が無ければ 404', async () => {
    const s = scene()
    const { response } = await compare(s, `a=${newId(TakeIdSchema)}`)

    expect(response.status).toBe(404)
  })

  it('A が別の Shot の Take なら 404（黙って他人の Take を映さない）', async () => {
    const s = scene()
    const { response } = await compare(s, `a=${s.otherShotTake.id}`)

    expect(response.status).toBe(404)
  })

  it('a を指定しなければ 422', async () => {
    const s = scene()
    const { response } = await compare(s, '')

    expect(response.status).toBe(422)
  })
})

describe('OpenAPI のコンポーネント名', () => {
  /**
   * `TimelineDocument` の component 名は `timeline.ts` が登録済みで、
   * このルートは**同じスキーマの実体を import して使い回す**。
   * 名前だけ同じ別のスキーマを登録すると `/openapi.json` 全体が壊れ、
   * 配線した側（Architect）の health のテストが落ちる。ここで先に潰しておく。
   */
  it('timeline と同じアプリに載せても OpenAPI を組める', () => {
    const s = scene()
    const app = new OpenAPIHono({ defaultHook: validationHook })
    app.route('/', timelineRoutes(s.deps))
    app.route('/', shotCompareRoutes(s.deps))

    const doc = app.getOpenAPIDocument({ openapi: '3.0.0', info: { title: 'test', version: '0' } })

    expect(doc.components?.schemas?.ShotCompare).toBeDefined()
    expect(doc.components?.schemas?.TimelineDocument).toBeDefined()
    expect(Object.keys(doc.paths)).toContain('/shots/{shotId}/compare')
  })
})
