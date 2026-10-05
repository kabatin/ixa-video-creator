import { OpenAPIHono } from '@hono/zod-openapi'
import {
  DEFAULT_NARRATION_TEXT_STYLE,
  MediaAssetId,
  VoiceJobId,
  lineReading,
  narrationLineOf,
  newId,
  voiceSpecHash,
  voiceSpecOf,
  type NarrationLine,
  type TimelineClip,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { turnOffLineTelop } from '../narration/telops.js'
import { clipRoutes } from '../routes/clips.js'
import { json, setupNarration, type Ok } from './narration-fixture.js'

/**
 * ナレーションのテロップは行から導かれる（ADR-0038）。行・声・設定を API で変えたら、その場で作り直す。
 * 手でテロップを消した行は「テロップなし」にして、付け直さない。
 */

type Setup = ReturnType<typeof setupNarration>

/** 声を選んで置いた行（2.4 秒・句点 2 つ = テロップ 2 枚）。テロップはまだ作っていない。 */
const placedLine = async (setup: Setup, patch: Partial<NarrationLine> = {}) => {
  const [line] = await setup.deps.lines.createMany([{ projectId: setup.project.id, order: 0, text: 'あいうえ。かきくけ。', startSec: 10 }])
  if (line === undefined) throw new Error('行がありません')
  const take = await setup.deps.takes.create({
    lineId: line.id,
    source: { type: 'generated', voiceJobId: newId(VoiceJobId), tool: 'stub', model: null, voiceName: 'stub' },
    mediaAssetId: newId(MediaAssetId),
    inSec: 0,
    outSec: 2.4,
    spokenText: line.text,
    displayText: line.text,
    specHash: null,
    charTimes: null,
    loudnessLufs: null,
    peaks: null,
    costUsd: 0,
  })
  return setup.deps.lines.update(line.id, { selectedTakeId: take.id, ...patch })
}

const telops = (setup: Setup): readonly TimelineClip[] =>
  setup.deps.timelineClips
    .snapshot()
    .filter((clip) => clip.content.type === 'text' && narrationLineOf(clip.content.params) !== null)

const styleOf = (clip: TimelineClip | undefined): unknown => (clip?.content.type === 'text' ? clip.content.params['style'] : undefined)

describe('行を変えると、テロップが付いてくる', () => {
  it('行を動かす（PATCH）と、テロップも動く', async () => {
    const setup = setupNarration()
    const line = await placedLine(setup)

    expect((await setup.send('PATCH', `/narration-lines/${line.id}`, { startSec: 20 })).status).toBe(200)

    expect(telops(setup).map((clip) => clip.startSec)).toEqual([20, 21.2])
  })

  it('並べる（arrange）と、並べた位置にテロップが付く', async () => {
    const setup = setupNarration()
    await placedLine(setup, { startSec: null })

    await setup.send('POST', `/projects/${setup.project.id}/narration/arrange`, { fromSec: 3, gapSec: 0.5 })

    expect(telops(setup)[0]?.startSec).toBe(3)
  })

  it('行を消すと、その行のテロップも消える', async () => {
    const setup = setupNarration()
    const line = await placedLine(setup)
    await setup.send('PATCH', `/narration-lines/${line.id}`, { startSec: 10 })
    expect(telops(setup)).toHaveLength(2)

    expect((await setup.send('DELETE', `/narration-lines/${line.id}`)).status).toBe(204)

    expect(telops(setup)).toEqual([])
  })

  it('読み辞書や強調の設定を保存すると、作り直す', async () => {
    const setup = setupNarration()
    await placedLine(setup)

    await setup.send('PUT', `/projects/${setup.project.id}/audio-settings`, {
      readingDictionary: [],
      ducking: { enabled: true, depthDb: 10, attackSec: 0.15, releaseSec: 0.4 },
    })

    expect(telops(setup)).toHaveLength(2)
  })

  it('声（Take）を選ぶと、テロップを作る', async () => {
    const setup = setupNarration()
    const line = await placedLine(setup, { selectedTakeId: null })
    const take = setup.deps.takes.snapshot()[0]
    if (take === undefined) throw new Error('Take がありません')

    expect((await setup.send('PATCH', `/narration-lines/${line.id}`, { selectedTakeId: take.id })).status).toBe(200)

    expect(telops(setup)).toHaveLength(2)
  })

  it('「声にする」で同じ Take を使い回したときも、テロップを作る', async () => {
    const setup = setupNarration()
    const voice = await setup.deps.voices.create({ projectId: setup.project.id, name: 'ナレーター', tool: 'stub', voiceName: 'stub' })
    const line = await placedLine(setup, { voiceProfileId: voice.id, selectedTakeId: null })
    const old = setup.deps.takes.snapshot()[0]
    if (old === undefined) throw new Error('Take がありません')
    const matching = await setup.deps.takes.create({
      ...old,
      specHash: await voiceSpecHash(voiceSpecOf(voice, line, lineReading(line, []).reading)),
    })

    const response = await setup.send('POST', `/narration-lines/${line.id}/speak`)

    expect((await json<Ok<{ reusedTakeId: string | null }>>(response)).data.reusedTakeId).toBe(matching.id)
    expect(telops(setup)).toHaveLength(2)
  })
})

describe('見た目', () => {
  it('話す声を変えると、その声の見た目に当て直す', async () => {
    const setup = setupNarration()
    const line = await placedLine(setup)
    await setup.send('PATCH', `/narration-lines/${line.id}`, { startSec: 10 })
    const look = await setup.deps.textStyles.create(setup.project.id, { name: '戦子', style: { anchor: 'top-center' } })
    const voice = await setup.deps.voices.create({ projectId: setup.project.id, name: '戦子の声', tool: 'stub', voiceName: 'stub', textStyleId: look.id })

    await setup.send('PATCH', `/narration-lines/${line.id}`, { voiceProfileId: voice.id })

    expect(styleOf(telops(setup)[0])).toEqual({ anchor: 'top-center' })
  })

  it('声の見た目を変えると、その声の行に当て直す。声を消すと既定に戻す', async () => {
    const setup = setupNarration()
    const voice = await setup.deps.voices.create({ projectId: setup.project.id, name: '戦子の声', tool: 'stub', voiceName: 'stub' })
    await placedLine(setup, { voiceProfileId: voice.id })
    const look = await setup.deps.textStyles.create(setup.project.id, { name: '戦子', style: { anchor: 'top-center' } })

    await setup.send('PATCH', `/voices/${voice.id}`, { textStyleId: look.id })
    expect(styleOf(telops(setup)[0])).toEqual({ anchor: 'top-center' })

    await setup.send('DELETE', `/voices/${voice.id}`)
    expect(styleOf(telops(setup)[0])).toEqual(DEFAULT_NARRATION_TEXT_STYLE)
  })

  it('声の名前だけを変えたときは、手で当てた見た目を残す', async () => {
    const setup = setupNarration()
    const voice = await setup.deps.voices.create({ projectId: setup.project.id, name: '戦子の声', tool: 'stub', voiceName: 'stub' })
    const line = await placedLine(setup, { voiceProfileId: voice.id })
    await setup.send('PATCH', `/narration-lines/${line.id}`, { startSec: 10 })
    const [first] = telops(setup)
    if (first?.content.type !== 'text') throw new Error('テロップがありません')
    await setup.deps.timelineClips.update(first.id, { content: { ...first.content, params: { ...first.content.params, style: { anchor: 'top-left' } } } })

    await setup.send('PATCH', `/voices/${voice.id}`, { name: '戦子' })
    await setup.send('PATCH', `/narration-lines/${line.id}`, { startSec: 12 })

    expect(telops(setup).map(styleOf)).toEqual([{ anchor: 'top-left' }, { anchor: 'top-left' }])
  })
})

describe('手でテロップを消す', () => {
  const withClips = (setup: Setup) => {
    const logger = createLogger('silent')
    const app = new OpenAPIHono({ defaultHook: validationHook })
    app.route(
      '/',
      clipRoutes({
        timelineClips: setup.deps.timelineClips,
        projects: setup.deps.projects,
        mediaAssets: setup.deps.mediaAssets,
        onNarrationTelopDeleted: (lineId) => turnOffLineTelop(setup.deps, lineId),
      }),
    )
    registerErrorHandlers(app, logger)
    return app
  }

  it('ナレーションのテロップを 1 枚消すと、その行は「テロップなし」になり、残りの枚も消える（付け直さない）', async () => {
    const setup = setupNarration()
    const line = await placedLine(setup)
    await setup.send('PATCH', `/narration-lines/${line.id}`, { startSec: 10 })
    const [first] = telops(setup)

    expect((await withClips(setup).request(`/clips/${String(first?.id)}`, { method: 'DELETE' })).status).toBe(204)

    expect(setup.deps.lines.snapshot()[0]?.telop).toBe(false)
    expect(telops(setup)).toEqual([])
    await setup.send('PATCH', `/narration-lines/${line.id}`, { startSec: 12 })
    expect(telops(setup)).toEqual([])
  })

  it('手で置いたテロップを消しても、行には触らない', async () => {
    const setup = setupNarration()
    await placedLine(setup)
    const manual = await setup.deps.timelineClips.create({
      projectId: setup.project.id,
      track: 'TEXT',
      startSec: 0,
      durationSec: 2,
      content: { type: 'text', templateKey: 'plain', params: { text: '手で置いた' } },
    })

    expect((await withClips(setup).request(`/clips/${manual.id}`, { method: 'DELETE' })).status).toBe(204)

    expect(setup.deps.lines.snapshot()[0]?.telop).toBe(true)
  })
})
