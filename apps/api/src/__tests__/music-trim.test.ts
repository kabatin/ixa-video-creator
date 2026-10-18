import { OpenAPIHono } from '@hono/zod-openapi'
import {
  MediaAssetId,
  MusicTrackId,
  newId,
  type MusicTrack,
  type Project,
  type Shot,
} from '@ixa/domain'
import { aShot, createInMemoryShotRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { editBatchRoutes, type UndoEditBatchResponse } from '../routes/edit-batches.js'
import { NO_MASTER_TRACK_MESSAGE, NO_SHOTS_MESSAGE, musicTrimRoutes } from '../routes/music-trim.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createInMemoryMusicTrackRepository, createInMemoryTimelineClipRepository } from './in-memory-timeline-repositories.js'
import { aProject } from './fixtures.js'

/**
 * 曲を最後の Shot で切る（制作者 2026-10-19「カットより長い部分は楽曲をカットするとか？」）。
 * 宣伝動画は Shot が 26.38 秒で終わるのに曲が 32 秒あり、尻が黒画面で書き出されていた。
 */

type TrimResult = { data: { track: MusicTrack; editBatchId: string | null } }

const aTrack = (project: Project, overrides: Partial<MusicTrack> = {}): MusicTrack => ({
  id: newId(MusicTrackId),
  projectId: project.id,
  mediaAssetId: newId(MediaAssetId),
  title: '宣伝の曲',
  isMaster: true,
  offsetSec: 0,
  volume: 1,
  fadeInSec: 0,
  fadeOutSec: 0,
  endSec: null,
  ...overrides,
})

const scene = (
  options: {
    readonly tracks?: (project: Project) => readonly MusicTrack[]
    readonly shots?: (project: Project) => readonly Shot[]
    /** 取り消しの記録が作れない（書く前に記録することを確かめる）。 */
    readonly recordFails?: boolean
  } = {},
) => {
  const project = aProject()
  const musicTracks = createInMemoryMusicTrackRepository(options.tracks?.(project) ?? [aTrack(project)])
  const shots = createInMemoryShotRepository(
    options.shots?.(project) ?? [
      aShot(project.id, { code: 'TT-01', startSec: 0, durationSec: 13.19 }),
      aShot(project.id, { code: 'TT-07', startSec: 13.19, durationSec: 13.19 }),
    ],
  )
  const editBatches = createInMemoryEditBatchRepository()
  const projects = createInMemoryProjectRepository([project])
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  const recorder =
    options.recordFails === true ? { create: () => Promise.reject(new Error('記録を作れません')) } : editBatches
  app.route('/', musicTrimRoutes({ projects, shots, musicTracks, editBatches: recorder }))
  app.route(
    '/',
    editBatchRoutes({
      projects,
      shots,
      editBatches,
      timelineClips: createInMemoryTimelineClipRepository(),
      musicTracks,
    }),
  )
  const trim = () => app.request(`/projects/${project.id}/music-tracks/trim-to-shots`, { method: 'POST' })
  return { app, project, musicTracks, editBatches, trim }
}

describe('POST /projects/{projectId}/music-tracks/trim-to-shots', () => {
  it('記録は書く前に作る（記録が作れなければ曲は切らない）', async () => {
    const s = scene({ recordFails: true })
    expect((await s.trim()).status).toBe(500)
    const [track] = await s.musicTracks.findByProject(s.project.id)
    expect(track?.endSec ?? null).toBeNull()
  })

  it('曲の終わりを最後の Shot の終わりにし、フェードアウトが 0 なら 0.5 秒にする', async () => {
    const s = scene()
    const res = await s.trim()

    expect(res.status).toBe(200)
    const { track, editBatchId } = ((await res.json()) as TrimResult).data
    expect(track.endSec).toBeCloseTo(26.38)
    expect(track.fadeOutSec).toBe(0.5)
    expect(editBatchId).not.toBeNull()
    expect(s.editBatches.snapshot()[0]?.kind).toBe('music_trim')
  })

  it('取り消すと、曲の終わりとフェードアウトが変える前へ戻る（音量は触らない）', async () => {
    const s = scene({ tracks: (project) => [aTrack(project, { fadeOutSec: 0, volume: 0.8 })] })
    const { editBatchId } = ((await (await s.trim()).json()) as TrimResult).data

    const res = await s.app.request(`/projects/${s.project.id}/edit-batches/${String(editBatchId)}/undo`, { method: 'POST' })
    expect(res.status).toBe(200)
    const undo = ((await res.json()) as { data: UndoEditBatchResponse }).data
    expect(undo.restoredMusicTracks).toHaveLength(1)
    expect(undo.failedMusicTracks).toEqual([])

    const [restored] = s.musicTracks.snapshot()
    expect(restored?.endSec).toBeNull()
    expect(restored?.fadeOutSec).toBe(0)
    expect(restored?.volume).toBe(0.8)
  })

  it('制作者が決めたフェードアウトは変えない', async () => {
    const s = scene({ tracks: (project) => [aTrack(project, { fadeOutSec: 2 })] })
    const { track } = ((await (await s.trim()).json()) as TrimResult).data

    expect(track.fadeOutSec).toBe(2)
  })

  it('もう切ってあれば何も変えず、記録も作らない', async () => {
    const s = scene({ tracks: (project) => [aTrack(project, { endSec: 26.38, fadeOutSec: 0.5 })] })
    const { editBatchId } = ((await (await s.trim()).json()) as TrimResult).data

    expect(editBatchId).toBeNull()
    expect(s.editBatches.snapshot()).toEqual([])
  })

  it('鳴らしている曲だけを切る（候補の曲は触らない）', async () => {
    const s = scene({
      tracks: (project) => [aTrack(project, { isMaster: false, title: '候補' }), aTrack(project, { isMaster: true })],
    })
    await s.trim()

    const byTitle = new Map(s.musicTracks.snapshot().map((track) => [track.title, track] as const))
    expect(byTitle.get('候補')?.endSec ?? null).toBeNull()
    expect(byTitle.get('宣伝の曲')?.endSec).toBeCloseTo(26.38)
  })

  it('曲が無い・Shot が無いなら 409 で理由を返す', async () => {
    const noTrack = await scene({ tracks: () => [] }).trim()
    expect(noTrack.status).toBe(409)
    expect(JSON.stringify(await noTrack.json())).toContain(NO_MASTER_TRACK_MESSAGE)

    const noShot = await scene({ shots: () => [] }).trim()
    expect(noShot.status).toBe(409)
    expect(JSON.stringify(await noShot.json())).toContain(NO_SHOTS_MESSAGE)
  })
})
