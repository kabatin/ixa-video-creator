import {
  MusicAnalysis as MusicAnalysisSchema,
  MusicAnalysisId as MusicAnalysisIdSchema,
  MusicTrack as MusicTrackSchema,
  MusicTrackId as MusicTrackIdSchema,
  NEAR_BEAT_SEC,
  ProjectId as ProjectIdSchema,
  ON_BEAT_SEC,
  newId,
  type MediaAsset,
  type MusicAnalysis,
  type MusicTrack,
  type Project,
} from '@ixa/domain'
import { aShot } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import {
  beatAlignmentRoutes,
  type BeatAlignmentRoutesDeps,
  type TimelineBeatAlignmentResponse,
} from '../routes/timeline.js'
import { aProject } from './fixtures.js'
import { createInMemoryMusicAnalysisRepository } from './in-memory-music-analysis-repository.js'
import {
  aMediaAsset,
  createInMemoryMusicTrackRepository,
} from './in-memory-timeline-repositories.js'
import { timelineDeps } from './timeline-deps.js'

/**
 * `GET /projects/:projectId/timeline/beat-alignment` の検証（P63-1）。
 * 実 DB / 実ストレージには接続しない。
 *
 * ここで守りたいのは 3 つ。
 * 1. しきい値を API が持たないこと（判定は `@ixa/domain` の `alignBoundary` だけ）
 * 2. **拍が無い理由を、ズレと別の値として返すこと**（L-015）
 * 3. 小節頭に乗っていることを、拍に乗っていることより強く返すこと
 */

type Ok<T> = { success: true; data: T }

const SONG_SEC = 116

const aSongAsset = (project: Project): MediaAsset =>
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

const aMusicTrack = (
  project: Project,
  mediaAssetId: MediaAsset['id'],
  overrides: Partial<MusicTrack> = {},
): MusicTrack =>
  MusicTrackSchema.parse({
    id: newId(MusicTrackIdSchema),
    projectId: project.id,
    mediaAssetId,
    title: 'iXA CUP',
    isMaster: true,
    offsetSec: 0,
    volume: 1,
    ...overrides,
  })

// 120BPM。拍は 0.5s 刻み、小節頭は 4 拍ごと。
const BEATS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
const DOWNBEATS = [0, 2]

const anAnalysis = (
  musicTrackId: MusicTrack['id'],
  beats: readonly number[] = BEATS,
  downbeats: readonly number[] = DOWNBEATS,
): MusicAnalysis =>
  MusicAnalysisSchema.parse({
    id: newId(MusicAnalysisIdSchema),
    musicTrackId,
    analyzerVersion: 'librosa-v1',
    durationSec: SONG_SEC,
    bpm: 120,
    bpmConfidence: 0.92,
    beats: [...beats],
    downbeats: [...downbeats],
    sections: [{ start: 0, end: SONG_SEC, label: 'intro', energy: 0.4 }],
    energyCurve: { hopSec: 0.05, values: [0, 0.5, 1] },
    onsets: [0.01],
    drops: [32.5],
    waveformPeaksKey: 'music/p/t/peaks.json',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  })

type SceneOptions = {
  /** Shot の開始位置。 */
  readonly startSecs?: readonly number[]
  /** 楽曲を登録するか。false なら `no_track`。 */
  readonly withTrack?: boolean
  /** 解析を積むか。false なら `no_analysis`。 */
  readonly withAnalysis?: boolean
  readonly beats?: readonly number[]
  readonly downbeats?: readonly number[]
  /** マスター以外の楽曲も混ぜる。選び方を確かめるため。 */
  readonly extraTrack?: boolean
}

type Scene = {
  readonly deps: BeatAlignmentRoutesDeps
  readonly project: Project
}

const scene = (options: SceneOptions = {}): Scene => {
  const project = aProject()
  const startSecs = options.startSecs ?? [0, 1.5]
  const shots = startSecs.map((startSec, index) =>
    aShot(project.id, {
      code: `shot_${String(index + 1).padStart(3, '0')}`,
      startSec,
      durationSec: 0.5,
    }),
  )

  const songAsset = aSongAsset(project)
  const track = aMusicTrack(project, songAsset.id)
  // マスターでない楽曲を先に置く。**先頭ではなくマスターを選ぶ**ことの確認用。
  const other = aMusicTrack(project, songAsset.id, { title: 'SE 集', isMaster: false })
  const tracks =
    options.withTrack === false ? [] : options.extraTrack === true ? [other, track] : [track]

  const analyses =
    options.withTrack === false || options.withAnalysis === false
      ? []
      : [anAnalysis(track.id, options.beats, options.downbeats)]

  return {
    project,
    deps: {
      // 書き出しと同じ依存の作り方に揃える。解析だけを 1 つ足す（app.ts と同じ形）。
      ...timelineDeps({ project, shots }),
      musicTracks: createInMemoryMusicTrackRepository(tracks),
      musicAnalyses: createInMemoryMusicAnalysisRepository(analyses),
    },
  }
}

const get = async (target: Scene) => {
  const response = await beatAlignmentRoutes(target.deps).request(
    `/projects/${target.project.id}/timeline/beat-alignment`,
  )
  const body = (await response.json()) as Ok<TimelineBeatAlignmentResponse>
  return { response, body }
}

describe('GET /projects/:projectId/timeline/beat-alignment', () => {
  it('Shot ごとに一番近い拍とズレを返す', async () => {
    const { response, body } = await get(scene({ startSecs: [1.5 + ON_BEAT_SEC / 2] }))

    expect(response.status).toBe(200)
    expect(body.data.source).toBe('available')
    expect(body.data.trackTitle).toBe('iXA CUP')
    expect(body.data.shots).toHaveLength(1)
    expect(body.data.shots[0]?.nearestBeatSec).toBe(1.5)
    expect(body.data.shots[0]?.driftSec).toBeCloseTo(ON_BEAT_SEC / 2, 6)
    expect(body.data.shots[0]?.alignment).toBe('on_beat')
  })

  it('小節頭に乗っている Shot は on_downbeat として返す', async () => {
    const { body } = await get(scene({ startSecs: [2] }))
    expect(body.data.shots[0]?.alignment).toBe('on_downbeat')
  })

  it('拍から外れている Shot は off_beat として返す', async () => {
    const { body } = await get(scene({ startSecs: [1 + NEAR_BEAT_SEC * 2] }))
    expect(body.data.shots[0]?.alignment).toBe('off_beat')
  })

  it('解析がまだ無ければ no_analysis を返し、ズレを名乗らない', async () => {
    const { body } = await get(scene({ withAnalysis: false }))

    expect(body.data.source).toBe('no_analysis')
    // **「外れている」ではない。** 解析を流せば直る状態なので色も文言も別にする。
    expect(body.data.shots.map((entry) => entry.alignment)).toEqual(['no_beats', 'no_beats'])
    expect(body.data.shots.every((entry) => entry.driftSec === null)).toBe(true)
    expect(body.data.shots.every((entry) => entry.nearestBeatSec === null)).toBe(true)
  })

  it('楽曲そのものが無ければ no_track を返す', async () => {
    const { body } = await get(scene({ withTrack: false }))
    expect(body.data.source).toBe('no_track')
    expect(body.data.trackTitle).toBeNull()
    expect(body.data.shots.map((entry) => entry.alignment)).toEqual(['no_beats', 'no_beats'])
  })

  it('解析はあるが拍が 0 件なら no_beats を返す（解析が無いのとは別）', async () => {
    const { body } = await get(scene({ beats: [] }))
    expect(body.data.source).toBe('no_beats')
    expect(body.data.trackTitle).toBe('iXA CUP')
  })

  it('楽曲が複数あってもマスター音源の解析を使う', async () => {
    const { body } = await get(scene({ extraTrack: true, startSecs: [2] }))
    expect(body.data.source).toBe('available')
    expect(body.data.trackTitle).toBe('iXA CUP')
    expect(body.data.shots[0]?.alignment).toBe('on_downbeat')
  })

  it('Shot が 1 件も無くても、拍の状態は返す', async () => {
    const { body } = await get(scene({ startSecs: [] }))
    expect(body.data.source).toBe('available')
    expect(body.data.shots).toEqual([])
  })

  it('Project が無ければ 404', async () => {
    const target = scene()
    const response = await beatAlignmentRoutes(target.deps).request(
      `/projects/${newId(ProjectIdSchema)}/timeline/beat-alignment`,
    )
    expect(response.status).toBe(404)
  })
})
