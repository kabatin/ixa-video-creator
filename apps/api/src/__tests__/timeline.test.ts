import {
  MediaAssetId as MediaAssetIdSchema,
  TimelineClipId as TimelineClipIdSchema,
  newId,
  type Project,
  type TimelineClip,
  type TimelineDocument,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { timelineRoutes, type TimelineRoutesDeps } from '../routes/timeline.js'
import { aProject, aShot } from './fixtures.js'
import { aShotWithTake, timelineDeps } from './timeline-deps.js'
import {
  aMediaAsset,
  createInMemoryMusicTrackRepository,
} from './in-memory-timeline-repositories.js'

type Ok<T> = { success: true; data: T }

/**
 * `GET /projects/:projectId/timeline` の検証。
 * 実 DB / 実ストレージには接続しない。
 */

const getTimeline = async (deps: TimelineRoutesDeps, project: Project) => {
  const response = await timelineRoutes(deps).request(`/projects/${project.id}/timeline`)
  const body = (await response.json()) as Ok<TimelineDocument>
  return { response, body }
}

describe('GET /projects/:projectId/timeline', () => {
  it('採用 Take のある Shot だけを VIDEO1 に載せる', async () => {
    const project = aProject()
    const withTake = aShotWithTake(project, { code: 'shot_001', startSec: 0, durationSec: 4 })
    // 採用 Take が無い Shot。黒画面を出さないため VIDEO1 には載せない。
    const withoutTake = aShot(project.id, { code: 'shot_002', startSec: 4, durationSec: 4 })

    const deps = timelineDeps({
      project,
      shots: [withTake.shot, withoutTake],
      takes: [withTake.take],
      mediaAssets: [withTake.asset],
      clips: [],
    })

    const { response, body } = await getTimeline(deps, project)

    expect(response.status).toBe(200)
    expect(body.data.video1).toHaveLength(1)
    expect(body.data.video1[0]?.shotId).toBe(withTake.shot.id)
    expect(body.data.video1[0]?.mediaUrl).toContain(withTake.asset.storageKey)
  })

  it('メディア URL は署名付き URL を都度発行する（DB には保存しない）', async () => {
    const project = aProject()
    const withTake = aShotWithTake(project)
    const deps = timelineDeps({
      project,
      shots: [withTake.shot],
      takes: [withTake.take],
      mediaAssets: [withTake.asset],
      clips: [],
    })

    const { body } = await getTimeline(deps, project)

    // createMemoryStorage の署名付き URL は memory://<key>?op=get&expires=<秒>
    expect(body.data.video1[0]?.mediaUrl).toBe(
      `memory://${withTake.asset.storageKey}?op=get&expires=3600`,
    )
  })

  it('解決できないクリップを unresolved として残す（無言で消さない）', async () => {
    const project = aProject()
    const withTake = aShotWithTake(project, { durationSec: 8 })

    const resolvable = aMediaAsset({ workspaceId: project.workspaceId, kind: 'image' })
    const clips: TimelineClip[] = [
      {
        id: newId(TimelineClipIdSchema),
        projectId: project.id,
        track: 'VIDEO2',
        startSec: 0,
        durationSec: 2,
        layer: 0,
        opacity: 1,
        content: { type: 'media', mediaAssetId: resolvable.id, inSec: 0, outSec: 2, volume: 1 },
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
      },
      {
        id: newId(TimelineClipIdSchema),
        projectId: project.id,
        track: 'VFX',
        startSec: 2,
        durationSec: 2,
        layer: 0,
        opacity: 1,
        // MediaAsset が存在しない ID。
        content: {
          type: 'media',
          mediaAssetId: newId(MediaAssetIdSchema),
          inSec: 0,
          outSec: 2,
          volume: 1,
        },
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    ]

    const deps = timelineDeps({
      project,
      shots: [withTake.shot],
      takes: [withTake.take],
      mediaAssets: [withTake.asset, resolvable],
      clips,
    })

    const { body } = await getTimeline(deps, project)

    const kinds = body.data.clips.map((clip) => clip.content.type)
    expect(kinds).toContain('media')
    expect(kinds).toContain('unresolved')

    const unresolved = body.data.clips.find((clip) => clip.content.type === 'unresolved')
    expect(unresolved?.content.type === 'unresolved' && unresolved.content.reason).toContain(
      'メディアを解決できません',
    )
  })

  it('レンダラに載せられない種別（font など）も unresolved にする', async () => {
    const project = aProject()
    const withTake = aShotWithTake(project)
    const font = aMediaAsset({ workspaceId: project.workspaceId, kind: 'font' })

    const deps = timelineDeps({
      project,
      shots: [withTake.shot],
      takes: [withTake.take],
      mediaAssets: [withTake.asset, font],
      clips: [
        {
          id: newId(TimelineClipIdSchema),
          projectId: project.id,
          track: 'TEXT',
          startSec: 0,
          durationSec: 1,
          layer: 0,
          opacity: 1,
          content: { type: 'media', mediaAssetId: font.id, inSec: 0, outSec: 1, volume: 1 },
          createdAt: new Date('2026-01-03T00:00:00.000Z'),
        },
      ],
    })

    const { body } = await getTimeline(deps, project)
    expect(body.data.clips[0]?.content.type).toBe('unresolved')
  })

  it('音楽の durationSec を MediaAsset の probe から取り、無ければ 0 にする', async () => {
    const project = aProject()
    const withTake = aShotWithTake(project)

    const probed = aMediaAsset({
      workspaceId: project.workspaceId,
      kind: 'audio',
      probe: { durationSec: 116, width: null, height: null, fps: null, hasAudio: true, codec: 'aac' },
    })
    const unprobed = aMediaAsset({ workspaceId: project.workspaceId, kind: 'audio', probe: null })

    const musicTracks = createInMemoryMusicTrackRepository()
    await musicTracks.create({
      projectId: project.id,
      mediaAssetId: probed.id,
      title: '本編',
      isMaster: true,
      offsetSec: 0,
    })
    await musicTracks.create({
      projectId: project.id,
      mediaAssetId: unprobed.id,
      title: '未解析',
      isMaster: false,
      offsetSec: 0,
    })

    const deps: TimelineRoutesDeps = {
      ...timelineDeps({
        project,
        shots: [withTake.shot],
        takes: [withTake.take],
        mediaAssets: [withTake.asset, probed, unprobed],
        clips: [],
      }),
      musicTracks,
    }

    const { body } = await getTimeline(deps, project)

    expect(body.data.audio.map((track) => track.durationSec)).toEqual([116, 0])
    // 音楽がタイムライン全体の尺を決める（Shot は 3.75 秒しかない）。
    expect(body.data.durationSec).toBe(116)
  })

  it('存在しないプロジェクトは 404', async () => {
    const project = aProject()
    const deps = timelineDeps({ project, shots: [], takes: [], mediaAssets: [], clips: [] })

    const other = aProject()
    const response = await timelineRoutes(deps).request(`/projects/${other.id}/timeline`)

    expect(response.status).toBe(404)
  })
})
