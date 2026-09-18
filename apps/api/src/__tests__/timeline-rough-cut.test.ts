import {
  MusicAnalysis as MusicAnalysisSchema,
  MusicAnalysisId as MusicAnalysisIdSchema,
  MusicTrack as MusicTrackSchema,
  MusicTrackId as MusicTrackIdSchema,
  ProjectId as ProjectIdSchema,
  newId,
  type MediaAsset,
  type MusicAnalysis,
  type MusicTrack,
  type Project,
  type Shot,
  type Take,
} from '@ixa/domain'
import type { RoughCutChange } from '@ixa/timeline'
import {
  aShot,
  aTake,
  createInMemoryShotRepository,
  type InMemoryShotRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import {
  roughCutRoutes,
  type RoughCutRoutesDeps,
  type RoughCutApplyResponse,
  type RoughCutPlanResponse,
} from '../routes/timeline.js'
import { aProject } from './fixtures.js'
import { createInMemoryEditBatchRepository, type InMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryMusicAnalysisRepository } from './in-memory-music-analysis-repository.js'
import {
  aMediaAsset,
  createInMemoryMusicTrackRepository,
} from './in-memory-timeline-repositories.js'
import { timelineDeps } from './timeline-deps.js'

/**
 * 粗編集の 2 口（P63-3）の検証。実 DB / 実ストレージには接続しない。
 *
 * ここで守りたいのは 3 つ。
 * 1. `plan` が**何も書かない**こと（押すまで何も変わらない）
 * 2. `apply` が**サーバで計算し直さない**こと（本文の案をそのまま当てる）
 * 3. 当てられなかったものを**理由つきで返す**こと（黙って落とさない）
 */

type Ok<T> = { success: true; data: T }

const SONG_SEC = 116
// 120BPM。拍は 0.5s 刻み。
const BEATS = Array.from({ length: 64 }, (_, i) => i * 0.5)
const DOWNBEATS = [0, 2, 4, 6]

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

const aTrack = (project: Project, mediaAssetId: MediaAsset['id']): MusicTrack =>
  MusicTrackSchema.parse({
    id: newId(MusicTrackIdSchema),
    projectId: project.id,
    mediaAssetId,
    title: 'iXA CUP',
    isMaster: true,
    offsetSec: 0,
    volume: 1,
  })

const anAnalysis = (musicTrackId: MusicTrack['id']): MusicAnalysis =>
  MusicAnalysisSchema.parse({
    id: newId(MusicAnalysisIdSchema),
    musicTrackId,
    analyzerVersion: 'librosa-v1',
    durationSec: SONG_SEC,
    bpm: 120,
    bpmConfidence: 0.9,
    beats: BEATS,
    downbeats: DOWNBEATS,
    sections: [{ start: 0, end: SONG_SEC, label: 'intro', energy: 0.4 }],
    energyCurve: { hopSec: 0.05, values: [0, 0.5, 1] },
    onsets: [0.01],
    drops: [32.5],
    waveformPeaksKey: 'music/p/t/peaks.json',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  })

type SceneOptions = {
  readonly project?: Project
  readonly shots?: readonly Shot[]
  readonly takes?: readonly Take[]
  readonly mediaAssets?: readonly MediaAsset[]
  readonly withMusic?: boolean
}

type Scene = {
  readonly deps: RoughCutRoutesDeps
  readonly project: Project
  readonly shots: InMemoryShotRepository
  /** 適用のたびに積まれる「変える前」の記録（P64-1）。 */
  readonly editBatches: InMemoryEditBatchRepository
}

const scene = (options: SceneOptions = {}): Scene => {
  const project = options.project ?? aProject()
  const songAsset = aSongAsset(project)
  const track = aTrack(project, songAsset.id)
  const withMusic = options.withMusic !== false

  const shots = createInMemoryShotRepository(options.shots ?? [])
  const editBatches = createInMemoryEditBatchRepository()
  const base = timelineDeps({
    project,
    takes: options.takes ?? [],
    mediaAssets: [songAsset, ...(options.mediaAssets ?? [])],
  })

  return {
    project,
    shots,
    editBatches,
    deps: {
      ...base,
      shots,
      editBatches,
      musicTracks: createInMemoryMusicTrackRepository(withMusic ? [track] : []),
      musicAnalyses: createInMemoryMusicAnalysisRepository(withMusic ? [anAnalysis(track.id)] : []),
    },
  }
}

const plan = async (s: Scene): Promise<RoughCutPlanResponse> => {
  const res = await roughCutRoutes(s.deps).request(
    `/projects/${s.project.id}/timeline/rough-cut/plan`,
    { method: 'POST' },
  )
  expect(res.status).toBe(200)
  return ((await res.json()) as Ok<RoughCutPlanResponse>).data
}

const apply = async (
  s: Scene,
  changes: readonly RoughCutChange[],
): Promise<RoughCutApplyResponse> => {
  const res = await roughCutRoutes(s.deps).request(
    `/projects/${s.project.id}/timeline/rough-cut/apply`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes }),
    },
  )
  expect(res.status).toBe(200)
  return ((await res.json()) as Ok<RoughCutApplyResponse>).data
}

/** 採用 Take とそのメディアを持つ Shot。VIDEO1 に載る最小構成。 */
const shotWithTake = (project: Project, overrides: Partial<Shot>) => {
  const asset = aMediaAsset({ workspaceId: project.workspaceId, projectId: project.id })
  const bare = aShot(project.id, overrides)
  const take = aTake(bare, 'f'.repeat(64), { mediaAssetId: asset.id })
  return { asset, take, shot: { ...bare, selectedTakeId: take.id } }
}

/** S1 は 0–4.0、S2 は 4.3 から。0.3s の隙間がある最小の題材。 */
const twoShots = () => {
  const project = aProject()
  const a = shotWithTake(project, { code: 'S1', order: 1, startSec: 0, durationSec: 4 })
  const b = shotWithTake(project, { code: 'S2', order: 2, startSec: 4.3, durationSec: 4 })
  const s = scene({
    project,
    shots: [a.shot, b.shot],
    takes: [a.take, b.take],
    mediaAssets: [a.asset, b.asset],
  })
  return { s, a, b }
}

describe('POST /timeline/rough-cut/plan', () => {
  it('隙間を閉じる案を、拍に合わせて返す', async () => {
    const { s, b } = twoShots()

    const result = await plan(s)
    const move = result.changes.find((change) => change.kind === 'move')

    expect(move).toMatchObject({ shotId: b.shot.id, fromSec: 4.3, toSec: 4.5 })
    expect(result.changes.length).toBeGreaterThan(0)
    for (const change of result.changes) expect(change.reason.length).toBeGreaterThan(0)
  })

  it('**何も書かない。** 案を作っただけでは Shot が動かない', async () => {
    const { s } = twoShots()

    const before = JSON.stringify(s.shots.snapshot())
    await plan(s)
    expect(JSON.stringify(s.shots.snapshot())).toBe(before)
  })

  it('Take が 1 件も無い Shot は理由つきで unresolved に出る', async () => {
    const project = aProject()
    const lonely = aShot(project.id, { code: 'S1', order: 1, startSec: 0, durationSec: 4 })
    const s = scene({ project, shots: [lonely] })

    const result = await plan(s)
    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0]?.reason).toContain('Take が 1 件も無い')
    expect(result.changes).toEqual([])
  })

  it('Project が無ければ 404', async () => {
    const s = scene()
    const res = await roughCutRoutes(s.deps).request(
      `/projects/${newId(ProjectIdSchema)}/timeline/rough-cut/plan`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /timeline/rough-cut/apply', () => {
  it('本文の案をそのまま当てる', async () => {
    const { s, b } = twoShots()
    const change: RoughCutChange = {
      kind: 'move',
      shotId: b.shot.id,
      fromSec: 4.3,
      toSec: 4.5,
      reason: '人が承認した案',
    }

    const result = await apply(s, [change])
    expect(result.applied).toHaveLength(1)
    expect(result.skipped).toEqual([])
    expect(s.shots.snapshot().find((shot) => shot.id === b.shot.id)?.startSec).toBe(4.5)
  })

  it('**サーバが計算し直さない。** 案が言うとおりの値になる（計算し直せば別の値になる）', async () => {
    const { s, b } = twoShots()
    // 拍は 0.5s 刻みなので、計算し直せば 4.5 になる。本文は 7.25（拍に無い値）。
    const change: RoughCutChange = {
      kind: 'move',
      shotId: b.shot.id,
      fromSec: 4.3,
      toSec: 7.25,
      reason: '人が手で直した案',
    }

    const result = await apply(s, [change])
    expect(result.applied).toHaveLength(1)
    expect(s.shots.snapshot().find((shot) => shot.id === b.shot.id)?.startSec).toBe(7.25)
  })

  it('案を作ったあとに Shot が動いていたら、当てずに理由を返す', async () => {
    const { s, b } = twoShots()
    await s.shots.update(b.shot.id, { startSec: 9 })

    const change: RoughCutChange = {
      kind: 'move',
      shotId: b.shot.id,
      fromSec: 4.3,
      toSec: 4.5,
      reason: '古い案',
    }

    const result = await apply(s, [change])
    expect(result.applied).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.reason).toContain('案を作ったあとに Shot が動いています')
    expect(s.shots.snapshot().find((shot) => shot.id === b.shot.id)?.startSec).toBe(9)
  })

  it('案を作ったあとに尺が変わっていたら、当てずに理由を返す', async () => {
    const { s, a } = twoShots()
    await s.shots.update(a.shot.id, { durationSec: 6 })

    const result = await apply(s, [
      {
        kind: 'trim',
        shotId: a.shot.id,
        fromDurationSec: 4,
        toDurationSec: 4.5,
        reason: '古い案',
      },
    ])

    expect(result.applied).toEqual([])
    expect(result.skipped[0]?.reason).toContain('尺が変わっています')
    expect(s.shots.snapshot().find((shot) => shot.id === a.shot.id)?.durationSec).toBe(6)
  })

  it('ロックされた Shot は動かさず、理由を返す', async () => {
    const { s, b } = twoShots()
    await s.shots.update(b.shot.id, { lockedAt: new Date('2026-09-17T00:00:00.000Z') })

    const result = await apply(s, [
      { kind: 'move', shotId: b.shot.id, fromSec: 4.3, toSec: 4.5, reason: '案' },
    ])

    expect(result.applied).toEqual([])
    expect(result.skipped[0]?.reason).toContain('ロック')
  })

  it('1 件当てられなくても残りは当てる', async () => {
    const { s, a, b } = twoShots()
    await s.shots.update(b.shot.id, { startSec: 9 })

    const result = await apply(s, [
      { kind: 'move', shotId: b.shot.id, fromSec: 4.3, toSec: 4.5, reason: '古い案' },
      { kind: 'trim', shotId: a.shot.id, fromDurationSec: 4, toDurationSec: 4.5, reason: '案' },
    ])

    expect(result.applied).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
    expect(s.shots.snapshot().find((shot) => shot.id === a.shot.id)?.durationSec).toBe(4.5)
  })

  it('別の Shot の Take は採用しない', async () => {
    const { s, a, b } = twoShots()

    const result = await apply(s, [
      { kind: 'select', shotId: a.shot.id, takeId: b.take.id, reason: '案' },
    ])

    expect(result.applied).toEqual([])
    expect(result.skipped[0]?.reason).toContain('別の Shot')
  })

  it('既に採用済みの Take は当て直さない', async () => {
    const { s, a } = twoShots()

    const result = await apply(s, [
      { kind: 'select', shotId: a.shot.id, takeId: a.take.id, reason: '案' },
    ])

    expect(result.applied).toEqual([])
    expect(result.skipped[0]?.reason).toContain('既にこの Take を採用しています')
  })

  it('ロックされた Shot は Take の採用も当てない', async () => {
    const project = aProject()
    const asset = aMediaAsset({ workspaceId: project.workspaceId, projectId: project.id })
    // 採用 Take が無い Shot。ロックが無ければこの案は当たる。
    const shot = aShot(project.id, { code: 'S1', order: 1, startSec: 0, durationSec: 4 })
    const take = aTake(shot, 'f'.repeat(64), { mediaAssetId: asset.id })
    const s = scene({ project, shots: [shot], takes: [take], mediaAssets: [asset] })
    await s.shots.update(shot.id, { lockedAt: new Date('2026-09-17T00:00:00.000Z') })

    const result = await apply(s, [
      { kind: 'select', shotId: shot.id, takeId: take.id, reason: '案' },
    ])

    expect(result.applied).toEqual([])
    expect(result.skipped[0]?.reason).toContain('変更しません')
    expect(s.shots.snapshot().find((row) => row.id === shot.id)?.selectedTakeId).toBeNull()
  })

  it('消えた Shot への案は、理由つきで返す', async () => {
    const { s, b } = twoShots()
    await s.shots.softDelete(b.shot.id)

    const result = await apply(s, [
      { kind: 'move', shotId: b.shot.id, fromSec: 4.3, toSec: 4.5, reason: '案' },
    ])

    expect(result.applied).toEqual([])
    expect(result.skipped[0]?.reason).toContain('Shot が見つかりません')
  })

  it('本文が壊れていれば 422', async () => {
    const { s } = twoShots()
    const res = await roughCutRoutes(s.deps).request(
      `/projects/${s.project.id}/timeline/rough-cut/apply`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changes: [{ kind: 'move', shotId: 'not-a-ulid' }] }),
      },
    )
    expect(res.status).toBe(422)
  })

  it('理由の無い案は受け取らない（採否の判断材料が消える）', async () => {
    const { s, b } = twoShots()
    const res = await roughCutRoutes(s.deps).request(
      `/projects/${s.project.id}/timeline/rough-cut/apply`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          changes: [{ kind: 'move', shotId: b.shot.id, fromSec: 4.3, toSec: 4.5, reason: '' }],
        }),
      },
    )
    expect(res.status).toBe(422)
  })
})

/**
 * 適用の記録（P64-1）。**書く直前に「変える前」を残す。**
 * 残っていないと、49 件が一度に変わる操作を戻せない。
 */
describe('粗編集の適用は「変える前」を記録する', () => {
  it('位置を動かした Shot の、動かす前の startSec を残す', async () => {
    const { s, b } = twoShots()
    const change: RoughCutChange = {
      kind: 'move', shotId: b.shot.id, fromSec: 4.3, toSec: 4.5, reason: '人が承認した案',
    }

    await apply(s, [change])

    const [batch] = s.editBatches.snapshot()
    expect(batch?.kind).toBe('rough_cut')
    expect(batch?.entries).toEqual([{ shotId: b.shot.id, patch: { startSec: 4.3 } }])
    // **採用 Take は触っていないので、欄そのものを作らない**（lessons L-021）。
    expect(batch?.entries[0] && 'selectedTakeId' in batch.entries[0]).toBe(false)
    expect(batch?.undoneAt).toBeNull()
  })

  it('採用 Take を変えたときは、変える前の採用を欄として残す', async () => {
    const project = aProject()
    const a = shotWithTake(project, { code: 'S1', order: 1, startSec: 0, durationSec: 4 })
    /** 同じ Shot の 2 本目。採用をこちらへ差し替える案にする。 */
    const second = aTake(a.shot, 'e'.repeat(64), { mediaAssetId: a.asset.id, index: 2 })
    const s = scene({
      project, shots: [a.shot], takes: [a.take, second], mediaAssets: [a.asset],
    })
    const change: RoughCutChange = {
      kind: 'select', shotId: a.shot.id, takeId: second.id, reason: '人が承認した案',
    }

    await apply(s, [change])

    const [batch] = s.editBatches.snapshot()
    expect(batch?.entries).toHaveLength(1)
    expect(batch?.entries[0]?.selectedTakeId).toBe(a.take.id)
    expect(batch?.entries[0]?.patch).toEqual({})
  })

  it('同じ Shot の位置と尺は 1 件に畳む', async () => {
    const { s, b } = twoShots()
    const changes: RoughCutChange[] = [
      { kind: 'move', shotId: b.shot.id, fromSec: 4.3, toSec: 4.5, reason: '案' },
      { kind: 'trim', shotId: b.shot.id, fromDurationSec: 4, toDurationSec: 3.5, reason: '案' },
    ]

    await apply(s, changes)

    const [batch] = s.editBatches.snapshot()
    expect(batch?.entries).toEqual([
      { shotId: b.shot.id, patch: { startSec: 4.3, durationSec: 4 } },
    ])
  })

  /**
   * **記録は書き込みの「直前」に作る。** 作れなかったなら 1 件も書かない。
   * 逆順だと、記録の無い変更が先に入ってしまう。
   */
  it('記録を作れなければ Shot を 1 件も書かない', async () => {
    const { s, b } = twoShots()
    const before = JSON.stringify(s.shots.snapshot())
    const failing = {
      create: () => Promise.reject(new Error('記録を作れませんでした')),
    }

    const res = await roughCutRoutes({ ...s.deps, editBatches: failing }).request(
      `/projects/${s.project.id}/timeline/rough-cut/apply`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          changes: [
            { kind: 'move', shotId: b.shot.id, fromSec: 4.3, toSec: 4.5, reason: '案' },
          ],
        }),
      },
    )

    expect(res.status).toBe(500)
    expect(JSON.stringify(s.shots.snapshot())).toBe(before)
  })

  it('1 件も当たらなかった適用では記録を作らない', async () => {
    const { s, b } = twoShots()
    // 案が前提にしていた位置と現在が違う（stale）ので、1 件も当たらない。
    const change: RoughCutChange = {
      kind: 'move', shotId: b.shot.id, fromSec: 99, toSec: 4.5, reason: '古い案',
    }

    const result = await apply(s, [change])
    expect(result.applied).toEqual([])
    expect(s.editBatches.snapshot()).toEqual([])
  })
})
