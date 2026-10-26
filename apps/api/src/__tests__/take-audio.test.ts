import { CharacterId, MAX_TAKE_AUDIO_VOLUME, type Project, type TimelineDocument } from '@ixa/domain'
import { aShot, createInMemoryShotRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import type { AppDeps } from '../app.js'
import { projectBeforeEntry } from '../routes/project-edit-recording.js'
import type { ProjectResponse } from '../routes/projects.js'
import { renderRoutes, type RenderJobResponse } from '../routes/renders.js'
import type { ShotResponse } from '../routes/shots.js'
import { timelineRoutes } from '../routes/timeline.js'
import { baseAppDeps, createTestApp } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { aShotWithTake, renderDeps } from './timeline-deps.js'
import type { ErrorBody, Ok } from './shot-test-support.js'

/** ADR-0060: Take の音（Shot の大きさと消音）と、書き出しの仕上げの音量（作品の設定）。 */

const patchJson = (app: ReturnType<typeof createTestApp>, path: string, body: unknown) =>
  app.request(path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const PROBE = { durationSec: 4, width: 1920, height: 1080, fps: 30, codec: 'h264' }

describe('PATCH /shots/:id の Take の音', () => {
  const setup = () => {
    const project = aProject()
    const shot = aShot(project.id)
    const shots = createInMemoryShotRepository([shot])
    const deps: AppDeps = { ...baseAppDeps(), projects: createInMemoryProjectRepository([project]), shots }
    return { app: createTestApp(deps), shot, shots }
  }

  it('大きさと消音を保存して返す', async () => {
    const f = setup()
    const res = await patchJson(f.app, `/shots/${f.shot.id}`, { takeAudioVolume: 1.4, takeAudioMuted: true })

    expect(res.status).toBe(200)
    expect(((await res.json()) as Ok<ShotResponse>).data).toMatchObject({ takeAudioVolume: 1.4, takeAudioMuted: true })
    expect(f.shots.snapshot()[0]).toMatchObject({ takeAudioVolume: 1.4, takeAudioMuted: true })
  })

  it.each([-0.1, MAX_TAKE_AUDIO_VOLUME + 0.1])('大きさ %s は 422 で保存しない', async (volume) => {
    const f = setup()
    const res = await patchJson(f.app, `/shots/${f.shot.id}`, { takeAudioVolume: volume })

    expect(res.status).toBe(422)
    expect(Object.keys(((await res.json()) as ErrorBody).fields ?? {})).toContain('takeAudioVolume')
    expect(f.shots.snapshot()[0]?.takeAudioVolume).toBe(1)
  })
})

describe('PATCH /projects/:id の仕上げの音量', () => {
  const setup = () => {
    const project = aProject()
    const projects = createInMemoryProjectRepository([project])
    return { app: createTestApp({ ...baseAppDeps(), projects }), project }
  }

  it('選べる。null に戻すと自動', async () => {
    const f = setup()
    const peak = await patchJson(f.app, `/projects/${f.project.id}`, { masteringMode: 'peak' })
    expect(((await peak.json()) as Ok<ProjectResponse>).data.masteringMode).toBe('peak')
    const auto = await patchJson(f.app, `/projects/${f.project.id}`, { masteringMode: null })
    expect(((await auto.json()) as Ok<ProjectResponse>).data.masteringMode).toBeNull()
  })

  it('知らない仕上げは 422', async () => {
    const f = setup()
    const res = await patchJson(f.app, `/projects/${f.project.id}`, { masteringMode: 'limiter' })
    expect(res.status).toBe(422)
  })

  it('取り消しのために、変える前（選んでいなかった）を控えられる', () => {
    expect(projectBeforeEntry(aProject(), { masteringMode: 'peak' })).toEqual({ patch: { masteringMode: null } })
  })
})

describe('タイムラインの Take の音（持ち込んだ・作った Take の probe から）', () => {
  const documentOf = async (project: Project, overrides: { readonly hasAudio: boolean; readonly muted: boolean }) => {
    const withTake = aShotWithTake(project, { startSec: 0, durationSec: 4, takeAudioMuted: overrides.muted, takeAudioVolume: 0.7 })
    const asset = { ...withTake.asset, probe: { ...PROBE, hasAudio: overrides.hasAudio } }
    const deps = renderDeps({ project, shots: [withTake.shot], takes: [withTake.take], mediaAssets: [asset] })
    const res = await timelineRoutes(deps).request(`/projects/${project.id}/timeline`)
    return ((await res.json()) as Ok<TimelineDocument>).data
  }

  it('Take に音があり消音していなければ、大きさを付けて鳴らす', async () => {
    const doc = await documentOf(aProject(), { hasAudio: true, muted: false })
    expect(doc.video1[0]?.audio).toEqual({ volume: 0.7 })
  })

  it('消音した Shot（前からある Shot）・音の無い Take は鳴らさない', async () => {
    expect((await documentOf(aProject(), { hasAudio: true, muted: true })).video1[0]?.audio).toBeUndefined()
    expect((await documentOf(aProject(), { hasAudio: false, muted: false })).video1[0]?.audio).toBeUndefined()
  })
})

describe('POST /projects/:projectId/render の仕上げ', () => {
  const SPEAKER = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB1')
  const talking = [{ speakerId: SPEAKER, text: 'ねえ', offscreen: false, translation: null }]

  const masteringOf = async (project: Project, dialogue: typeof talking | [] = []) => {
    const withTake = aShotWithTake(project, { startSec: 0, durationSec: 4, dialogue })
    const deps = renderDeps({ project, shots: [withTake.shot], takes: [withTake.take], mediaAssets: [withTake.asset] })
    const res = await renderRoutes(deps).request(`/projects/${project.id}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset: 'master_1080p' }),
    })
    expect(res.status).toBe(202)
    const list = await renderRoutes(deps).request(`/projects/${project.id}/renders`)
    return ((await list.json()) as Ok<RenderJobResponse[]>).data[0]?.masteringMode
  }

  it('セリフの無い作品（MV）は前と同じく全体をそろえる', async () => {
    expect(await masteringOf(aProject())).toBe('loudnorm')
  })

  it('選んでいなければ、セリフのある作品は山だけ抑える', async () => {
    expect(await masteringOf(aProject(), talking)).toBe('peak')
  })

  it('制作者が選んだら、セリフがあってもその通り', async () => {
    expect(await masteringOf(aProject({ masteringMode: 'loudnorm' }), talking)).toBe('loudnorm')
  })
})
