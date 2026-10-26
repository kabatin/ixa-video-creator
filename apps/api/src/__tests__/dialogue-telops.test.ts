import { WorkspaceId as WorkspaceIdSchema, dialogueTelopOf, newId, type MediaProbe, type TimelineClip } from '@ixa/domain'
import {
  aShot,
  createInMemoryCharacterRepository,
  createInMemoryMediaAssetRepository,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import type { AppDeps } from '../app.js'
import type { EditBatchSummaryResponse } from '../routes/edit-batches.js'
import { baseAppDeps, createTestApp } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createInMemoryTimelineClipRepository } from './in-memory-timeline-repositories.js'
import type { ErrorBody, Ok } from './shot-test-support.js'
import { aShotWithTake } from './timeline-deps.js'

/**
 * セリフの字幕（ADR-0061）。Shot を変える口のあとで作り直し、字幕の訳文を直すと Shot の行へ書き戻す。
 * セリフの無い作品のテロップは触らない。
 */

const send = (app: ReturnType<typeof createTestApp>, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const PROBE: MediaProbe = { durationSec: 3.75, width: 1920, height: 1080, fps: 30, hasAudio: true, codec: 'h264' }

const setup = async (options: { readonly withTake?: MediaProbe } = {}) => {
  const project = aProject()
  const characters = createInMemoryCharacterRepository()
  const cat = await characters.create({
    workspaceId: newId(WorkspaceIdSchema),
    projectId: project.id,
    name: 'ネコ',
    displayName: 'ネコ',
    speechName: 'The cat',
    voiceDescription: 'a calm voice',
  })
  const seeded = options.withTake === undefined ? null : aShotWithTake(project, { startSec: 2, durationSec: 4 })
  const shot = seeded?.shot ?? aShot(project.id, { startSec: 2, durationSec: 4 })
  const shots = createInMemoryShotRepository([shot])
  const timelineClips = createInMemoryTimelineClipRepository()
  const deps: AppDeps = {
    ...baseAppDeps(),
    projects: createInMemoryProjectRepository([project]),
    shots,
    characters,
    timelineClips,
    ...(seeded === null
      ? {}
      : {
          takes: createInMemoryTakeRepository([seeded.take]),
          mediaAssets: createInMemoryMediaAssetRepository([{ ...seeded.asset, probe: options.withTake ?? null }]),
        }),
  }
  return { app: createTestApp(deps), project, shot, shots, timelineClips, cat }
}

const dialogueTelops = (clips: readonly TimelineClip[]) =>
  clips
    .filter((clip) => clip.content.type === 'text' && dialogueTelopOf(clip.content.params) !== null)
    .sort((a, b) => a.startSec - b.startSec)

const lines = (speakerId: string) => [
  { speakerId, text: 'あいう' },
  { speakerId, text: 'かきくけこさ' },
]

describe('Shot を変えたらセリフの字幕を作り直す', () => {
  it('セリフを保存すると、行ごとの字幕ができる（Take が無ければ尺を文字数で割り振る）', async () => {
    const f = await setup()
    const res = await send(f.app, 'PATCH', `/shots/${f.shot.id}`, { dialogue: lines(f.cat.id) })
    expect(res.status).toBe(200)
    const telops = dialogueTelops(f.timelineClips.snapshot())
    expect(telops.map((clip) => [clip.startSec, clip.durationSec, clip.layer])).toEqual([
      [2, 1.333, 2],
      [3.333, 2.667, 2],
    ])
  })

  it('音を鳴らす Take の話している区間が行の数と合えば、区間を当てる', async () => {
    const f = await setup({ withTake: { ...PROBE, speechSegments: [{ startSec: 0.5, endSec: 1.2 }, { startSec: 1.8, endSec: 3.5 }] } })
    await send(f.app, 'PATCH', `/shots/${f.shot.id}`, { dialogue: lines(f.cat.id) })
    expect(dialogueTelops(f.timelineClips.snapshot()).map((clip) => [clip.startSec, clip.durationSec])).toEqual([
      [2.5, 0.7],
      [3.8, 1.7],
    ])
  })

  it('Shot を消すと、その字幕も消える', async () => {
    const f = await setup()
    await send(f.app, 'PATCH', `/shots/${f.shot.id}`, { dialogue: lines(f.cat.id) })
    const res = await send(f.app, 'DELETE', `/shots/${f.shot.id}`)
    expect(res.status).toBeLessThan(300)
    expect(dialogueTelops(f.timelineClips.snapshot())).toEqual([])
  })

  it('Shot を消して取り消すと、字幕も同じ ID・同じ時刻で戻る', async () => {
    const f = await setup()
    await send(f.app, 'PATCH', `/shots/${f.shot.id}`, { dialogue: lines(f.cat.id) })
    const [first] = dialogueTelops(f.timelineClips.snapshot())
    if (first === undefined) throw new Error('字幕があるはず')
    await send(f.app, 'PATCH', `/clips/${first.id}`, { startSec: 2.2, durationSec: 0.8 })
    await send(f.app, 'DELETE', `/shots/${f.shot.id}`)
    const history = (await (await send(f.app, 'GET', `/projects/${f.project.id}/edit-batches`)).json()) as {
      data: EditBatchSummaryResponse[]
    }
    const latest = history.data[0]
    if (latest === undefined) throw new Error('記録があるはず')
    expect((await send(f.app, 'POST', `/projects/${f.project.id}/edit-batches/${latest.id}/undo`)).status).toBe(200)
    const [back] = dialogueTelops(f.timelineClips.snapshot())
    expect(back).toMatchObject({ id: first.id, startSec: 2.2, durationSec: 0.8 })
  })

  it('セリフの無い作品は、Shot を直してもテロップを書き換えない', async () => {
    const f = await setup()
    const lyric = await f.timelineClips.create({
      projectId: f.project.id,
      track: 'TEXT',
      startSec: 1,
      durationSec: 2,
      layer: 1,
      content: { type: 'text', templateKey: 'plain', params: { text: '歌詞', lyricLine: 0 } },
    })
    const res = await send(f.app, 'PATCH', `/shots/${f.shot.id}`, { description: '歌い出す' })
    expect(res.status).toBe(200)
    expect(f.timelineClips.snapshot()).toEqual([lyric])
  })

  it('失敗した書き込み（422）のあとは作り直さない', async () => {
    const f = await setup()
    const res = await send(f.app, 'PATCH', `/shots/${f.shot.id}`, { dialogue: [{ speakerId: f.cat.id, text: '' }] })
    expect(res.status).toBe(422)
    expect(f.timelineClips.snapshot()).toEqual([])
  })
})

describe('字幕の訳文を直すと、Shot の行へ書き戻す', () => {
  const withTelops = async () => {
    const f = await setup()
    await send(f.app, 'PATCH', `/shots/${f.shot.id}`, { dialogue: lines(f.cat.id) })
    const [first] = dialogueTelops(f.timelineClips.snapshot())
    if (first === undefined || first.content.type !== 'text') throw new Error('字幕があるはず')
    return { ...f, first, content: first.content }
  }

  it('行の訳文が変わり、字幕にも出る。取り消すと行も字幕も戻る', async () => {
    const f = await withTelops()
    const res = await send(f.app, 'PATCH', `/clips/${f.first.id}`, {
      content: { ...f.content, params: { ...f.content.params, translation: '  Hey.  ' } },
    })
    expect(res.status).toBe(200)
    expect(f.shots.snapshot()[0]?.dialogue[0]?.translation).toBe('Hey.')
    expect(dialogueTelops(f.timelineClips.snapshot())[0]?.content).toMatchObject({ params: { translation: 'Hey.' } })

    const history = (await (await send(f.app, 'GET', `/projects/${f.project.id}/edit-batches`)).json()) as {
      data: EditBatchSummaryResponse[]
    }
    const latest = history.data[0]
    if (latest === undefined) throw new Error('記録があるはず')
    const undo = await send(f.app, 'POST', `/projects/${f.project.id}/edit-batches/${latest.id}/undo`)
    expect(undo.status).toBe(200)
    expect(f.shots.snapshot()[0]?.dialogue[0]?.translation).toBeNull()
    expect(dialogueTelops(f.timelineClips.snapshot())[0]?.content).not.toMatchObject({ params: { translation: 'Hey.' } })
  })

  it('訳文を空にすると、行の訳文は無しになり、字幕の 2 段目も消える', async () => {
    const f = await withTelops()
    await send(f.app, 'PATCH', `/clips/${f.first.id}`, { content: { ...f.content, params: { ...f.content.params, translation: 'Hey.' } } })
    const [again] = dialogueTelops(f.timelineClips.snapshot())
    if (again === undefined || again.content.type !== 'text') throw new Error('字幕があるはず')
    await send(f.app, 'PATCH', `/clips/${again.id}`, { content: { ...again.content, params: { ...again.content.params, translation: '' } } })
    expect(f.shots.snapshot()[0]?.dialogue[0]?.translation).toBeNull()
    expect(dialogueTelops(f.timelineClips.snapshot())[0]?.content).not.toHaveProperty('params.translation')
  })

  it('長すぎる・文字でない訳文は 422 で、行も字幕も変えない', async () => {
    const f = await withTelops()
    for (const translation of ['a'.repeat(401), 42]) {
      const res = await send(f.app, 'PATCH', `/clips/${f.first.id}`, { content: { ...f.content, params: { ...f.content.params, translation } } })
      expect(res.status).toBe(422)
      expect(Object.keys(((await res.json()) as ErrorBody).fields ?? {})).toContain('content.params.translation')
    }
    expect(f.shots.snapshot()[0]?.dialogue[0]?.translation).toBeNull()
  })

  it('ふつうのテロップの訳文はそのまま保存する（行は無いので書き戻さない）', async () => {
    const f = await setup()
    const res = await send(f.app, 'POST', `/projects/${f.project.id}/clips`, {
      track: 'TEXT',
      startSec: 0,
      durationSec: 2,
      content: { type: 'text', templateKey: 'plain', params: { text: 'こんにちは', translation: 'Hello' } },
    })
    expect(res.status).toBe(201)
    const { data } = (await res.json()) as Ok<{ content: { params: Record<string, unknown> } }>
    expect(data.content.params).toEqual({ text: 'こんにちは', translation: 'Hello' })
  })
})
