import { OpenAPIHono } from '@hono/zod-openapi'
import {
  MediaAssetId as MediaAssetIdSchema,
  MusicAnalysis as MusicAnalysisSchema,
  MusicAnalysisId as MusicAnalysisIdSchema,
  MusicTrackId as MusicTrackIdSchema,
  SequenceId as SequenceIdSchema,
  newId,
  type MusicAnalysis,
  type MusicSection,
  type MusicTrack,
} from '@ixa/domain'
import { createInMemoryShotRepository } from '@ixa/generation/testing'
import { TIMELINE_ISSUE_CODES, validateTimeline } from '@ixa/timeline'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import {
  storyboardRoutes,
  ANALYSIS_REQUIRED_MESSAGE,
  FOREIGN_SEQUENCE_MESSAGE,
  FOREIGN_TRACK_MESSAGE,
  SECTION_OUT_OF_RANGE_MESSAGE,
  type StoryboardRoutesDeps,
} from '../routes/storyboard.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createInMemoryMusicAnalysisRepository } from './in-memory-music-analysis-repository.js'
import { createInMemorySequenceRepository } from './in-memory-script-repositories.js'
import { createInMemoryMusicTrackRepository } from './in-memory-timeline-repositories.js'

type SuccessBody<T> = { success: true; data: T }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }

type ShotBody = {
  id: string
  code: string
  order: number
  startSec: number
  durationSec: number
  sequenceId: string | null
  status: string
}
type AllocateBody = {
  shots: ShotBody[]
  requestedCount: number
  createdCount: number
  section: { index: number; label: string }
  warnings: string[]
}

const project = aProject()
const otherProject = aProject({ name: '別の Project' })

/** 120 BPM ちょうど。0.5 秒ごとの拍が 0〜64 秒に並ぶ。 */
const BEAT_INTERVAL_SEC = 0.5
const beatsUpTo = (endSec: number): number[] =>
  Array.from({ length: Math.floor(endSec / BEAT_INTERVAL_SEC) + 1 }, (_, i) => i * BEAT_INTERVAL_SEC)

/** intro 0〜32 秒、chorus 32〜56 秒。DoD の例（chorus を 8 カットに割る）に合わせる。 */
const SECTIONS: readonly MusicSection[] = [
  { start: 0, end: 32, label: 'intro', energy: 0.3 },
  { start: 32, end: 56, label: 'chorus', energy: 0.9 },
]

const anAnalysis = (track: MusicTrack, overrides: Partial<MusicAnalysis> = {}): MusicAnalysis =>
  MusicAnalysisSchema.parse({
    id: newId(MusicAnalysisIdSchema),
    musicTrackId: track.id,
    analyzerVersion: 'librosa-v1',
    durationSec: 116,
    bpm: 120,
    bpmConfidence: 0.95,
    beats: beatsUpTo(64),
    downbeats: [0, 2, 4],
    sections: SECTIONS,
    energyCurve: { hopSec: 0.05, values: [0, 0.5, 1] },
    onsets: [0.01],
    drops: [32],
    waveformPeaksKey: 'music/p/t/peaks.json',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  })

let deps: StoryboardRoutesDeps
let track: MusicTrack
let app: OpenAPIHono

const buildApp = (d: StoryboardRoutesDeps) => {
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', storyboardRoutes(d))
  registerErrorHandlers(app, createLogger('silent'))
  return app
}

const allocate = (payload: Record<string, unknown>, projectId: string = project.id) =>
  app.request(`/projects/${projectId}/storyboard/shots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T

beforeEach(async () => {
  const musicTracks = createInMemoryMusicTrackRepository()
  const musicAnalyses = createInMemoryMusicAnalysisRepository()
  track = await musicTracks.create({
    projectId: project.id,
    mediaAssetId: newId(MediaAssetIdSchema),
    title: 'iXA CUP MUSIC VIDEO',
    isMaster: true,
    offsetSec: 0,
    volume: 1,
  })
  await musicAnalyses.create(anAnalysis(track))

  deps = {
    shots: createInMemoryShotRepository(),
    musicTracks,
    musicAnalyses,
    sequences: createInMemorySequenceRepository(),
    projects: createInMemoryProjectRepository([project, otherProject]),
  }
  app = buildApp(deps)
})

describe('セクションから Shot を割る', () => {
  it('chorus 32〜56 秒を 8 カットに割る（Definition of Done の例）', async () => {
    const res = await allocate({ musicTrackId: track.id, sectionIndex: 1, requestedCount: 8 })

    expect(res.status).toBe(201)
    const body = await json<SuccessBody<AllocateBody>>(res)
    expect(body.data.createdCount).toBe(8)
    expect(body.data.section).toEqual({ index: 1, label: 'chorus' })
    expect(body.data.warnings).toEqual([])
  })

  it('割った Shot に隙間も重なりも無い', async () => {
    const res = await allocate({ musicTrackId: track.id, sectionIndex: 1, requestedCount: 8 })
    const { shots } = (await json<SuccessBody<AllocateBody>>(res)).data

    const ordered = [...shots].sort((a, b) => a.startSec - b.startSec)
    expect(ordered[0]?.startSec).toBe(32)

    for (let i = 0; i + 1 < ordered.length; i += 1) {
      const current = ordered[i] as ShotBody
      const next = ordered[i + 1] as ShotBody
      expect(current.startSec + current.durationSec).toBeCloseTo(next.startSec, 9)
    }

    const last = ordered[ordered.length - 1] as ShotBody
    expect(last.startSec + last.durationSec).toBeCloseTo(56, 9)
  })

  it('境界がすべてビートの上に載っている', async () => {
    const res = await allocate({ musicTrackId: track.id, sectionIndex: 1, requestedCount: 8 })
    const { shots } = (await json<SuccessBody<AllocateBody>>(res)).data

    const beats = beatsUpTo(64)
    for (const shot of shots) {
      expect(beats.some((beat) => Math.abs(beat - shot.startSec) < 1e-9)).toBe(true)
    }
  })

  it('order は既存 Shot の後ろに続き、code は読める形になる', async () => {
    await deps.shots.create({
      projectId: project.id,
      sequenceId: null,
      order: 0,
      code: 'S01-010',
      startSec: 0,
      durationSec: 4,
      sourceInSec: 0,
      description: '',
      dialogue: null,
      camera: {
        size: 'medium', angleH: null, angle: null,
        lensMm: null, movement: null, movementIntensity: null,
      },
      mood: null,
      locationId: null,
      sourceType: { type: 'ai_video' },
      status: 'draft',
    })

    const res = await allocate({ musicTrackId: track.id, sectionIndex: 1, requestedCount: 3 })
    const { shots } = (await json<SuccessBody<AllocateBody>>(res)).data

    expect(shots.map((shot) => shot.order)).toEqual([1, 2, 3])
    expect(shots.map((shot) => shot.code)).toEqual(['CHORUS-01', 'CHORUS-02', 'CHORUS-03'])
  })

  it('同じラベルのセクションを 2 回割っても code が衝突しない', async () => {
    /**
     * `(project_id, code)` は UNIQUE。ラベルは曲中で繰り返されるため、
     * ラベルと枠内連番だけで採番すると 2 回目の一括作成ごと失敗する（実際に 500 を踏んだ）。
     */
    const first = await allocate({ musicTrackId: track.id, sectionIndex: 1, requestedCount: 3 })
    expect(first.status).toBe(201)

    const second = await allocate({ musicTrackId: track.id, sectionIndex: 1, requestedCount: 3 })
    expect(second.status).toBe(201)

    const codes = (await deps.shots.findByProject(project.id)).map((shot) => shot.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).toHaveLength(6)
  })

  it('既存の Shot と同じ code を避けて採番する', async () => {
    await deps.shots.create({
      projectId: project.id,
      sequenceId: null,
      order: 0,
      code: 'CHORUS-01',
      startSec: 0,
      durationSec: 4,
      sourceInSec: 0,
      description: '',
      dialogue: null,
      camera: {
        size: 'medium', angleH: null, angle: null,
        lensMm: null, movement: null, movementIntensity: null,
      },
      mood: null,
      locationId: null,
      sourceType: { type: 'ai_video' },
      status: 'draft',
    })

    const res = await allocate({ musicTrackId: track.id, sectionIndex: 1, requestedCount: 2 })
    const { shots } = (await json<SuccessBody<AllocateBody>>(res)).data

    expect(shots.map((shot) => shot.code)).toEqual(['CHORUS-02', 'CHORUS-03'])
  })

  it('作られた Shot は draft で、演出は空のまま残る', async () => {
    const res = await allocate({ musicTrackId: track.id, sectionIndex: 0, requestedCount: 2 })
    const { shots } = (await json<SuccessBody<AllocateBody>>(res)).data

    expect(shots.every((shot) => shot.status === 'draft')).toBe(true)
    expect(shots.every((shot) => shot.sequenceId === null)).toBe(true)
  })

  it('subdivision を細かくすると、より多くのカットに割れる', async () => {
    const res = await allocate({
      musicTrackId: track.id,
      sectionIndex: 1,
      requestedCount: 48,
      subdivision: 0.5,
    })

    const body = await json<SuccessBody<AllocateBody>>(res)
    expect(body.data.createdCount).toBe(48)
    expect(body.data.warnings).toEqual([])
  })
})

describe('タイムライン検証', () => {
  /**
   * Definition of Done の「隙間も重なりも無い」を、テスト独自の判定ではなく
   * **実際にレンダリング前に走る検証器**で確かめる。
   * 独自判定だけだと、検証器の基準が変わったときに気づけない。
   */
  it('割った Shot だけのタイムラインに、隙間も重なりも報告されない', async () => {
    await allocate({ musicTrackId: track.id, sectionIndex: 1, requestedCount: 8 })

    const shots = await deps.shots.findByProject(project.id)
    const issues = validateTimeline({
      project: { fps: project.fps, resolution: project.resolution },
      shots,
      transitions: [],
      clips: [],
      musicTracks: [],
      // 採用 Take はまだ無い。ここで見たいのは時間の整合だけ。
      resolveShotMedia: () => 'file:///stub.mp4',
      resolveClipMedia: () => undefined,
    })

    const timingCodes: readonly string[] = [
      TIMELINE_ISSUE_CODES.shotGap,
      TIMELINE_ISSUE_CODES.shotOverlap,
    ]
    expect(issues.filter((issue) => timingCodes.includes(issue.code))).toEqual([])
  })
})

describe('グリッドが支えられないとき', () => {
  it('カット数を減らし、減らした理由を warning で返す（黙って減らさない）', async () => {
    const res = await allocate({ musicTrackId: track.id, sectionIndex: 1, requestedCount: 500 })

    expect(res.status).toBe(201)
    const body = await json<SuccessBody<AllocateBody>>(res)
    expect(body.data.requestedCount).toBe(500)
    expect(body.data.createdCount).toBeLessThan(500)
    expect(body.data.warnings).toHaveLength(1)
    expect(body.data.warnings[0]).toContain('上限')
  })
})

describe('入力の検証', () => {
  it('存在しない Project は 404', async () => {
    const res = await allocate(
      { musicTrackId: track.id, sectionIndex: 1, requestedCount: 4 },
      aProject().id,
    )
    expect(res.status).toBe(404)
  })

  it('存在しない楽曲は 404', async () => {
    const res = await allocate({
      musicTrackId: newId(MusicTrackIdSchema),
      sectionIndex: 1,
      requestedCount: 4,
    })
    expect(res.status).toBe(404)
  })

  it('他 Project の楽曲では割れない（別の曲のビートに載った Shot を混ぜない）', async () => {
    const foreign = await deps.musicTracks.create({
      projectId: otherProject.id,
      mediaAssetId: track.mediaAssetId,
      title: '別の曲',
      isMaster: true,
      offsetSec: 0,
      volume: 1,
    })
    await deps.musicAnalyses.create(anAnalysis(foreign))

    const res = await allocate({
      musicTrackId: foreign.id,
      sectionIndex: 1,
      requestedCount: 4,
    })

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.musicTrackId).toEqual([FOREIGN_TRACK_MESSAGE])
  })

  it('未解析の楽曲は 422 で、先に解析するよう返す', async () => {
    const unanalyzed = await deps.musicTracks.create({
      projectId: project.id,
      mediaAssetId: track.mediaAssetId,
      title: '未解析',
      isMaster: false,
      offsetSec: 0,
      volume: 1,
    })

    const res = await allocate({
      musicTrackId: unanalyzed.id,
      sectionIndex: 0,
      requestedCount: 4,
    })

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.musicTrackId).toEqual([ANALYSIS_REQUIRED_MESSAGE])
  })

  it('範囲外のセクション添字は 422', async () => {
    const res = await allocate({ musicTrackId: track.id, sectionIndex: 99, requestedCount: 4 })

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.sectionIndex).toEqual([SECTION_OUT_OF_RANGE_MESSAGE])
  })

  it('他 Project の Sequence は 422', async () => {
    const res = await allocate({
      musicTrackId: track.id,
      sectionIndex: 1,
      requestedCount: 4,
      sequenceId: newId(SequenceIdSchema),
    })

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.sequenceId).toEqual([FOREIGN_SEQUENCE_MESSAGE])
  })

  it('requestedCount が 0 以下なら 422', async () => {
    const res = await allocate({ musicTrackId: track.id, sectionIndex: 1, requestedCount: 0 })
    expect(res.status).toBe(422)
  })

  it('失敗したときは Shot を 1 つも作らない', async () => {
    await allocate({ musicTrackId: track.id, sectionIndex: 99, requestedCount: 4 })
    expect(await deps.shots.findByProject(project.id)).toHaveLength(0)
  })
})

describe('Sequence への所属', () => {
  it('同じ Project の Sequence を指定すると、その配下に作られる', async () => {
    const sequence = await deps.sequences.create({
      projectId: project.id,
      order: 0,
      name: 'サビ',
      musicSectionLabel: 'chorus',
    })

    const res = await allocate({
      musicTrackId: track.id,
      sectionIndex: 1,
      requestedCount: 4,
      sequenceId: sequence.id,
    })

    expect(res.status).toBe(201)
    const { shots } = (await json<SuccessBody<AllocateBody>>(res)).data
    expect(shots.every((shot) => shot.sequenceId === sequence.id)).toBe(true)
  })
})
