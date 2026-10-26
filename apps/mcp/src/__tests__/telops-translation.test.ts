import { describe, expect, it } from 'vitest'
import { editClipsTool } from '../tools/edit-clips.js'
import { addTelopsTool, listTelopsTool, removeTelopsTool } from '../tools/telops.js'
import { createFakeApi, depsFor, jsonOf, textOf, ulid } from './fake-api.js'

/**
 * 2 段字幕（ADR-0061）。ふつうのテロップにも訳文（下の段）を付けられ、セリフの字幕は訳文を直すと Shot の行へ書き戻る
 * （書き戻すのは api の PATCH /clips。ここは訳文を送るだけ）。
 */

const PROJECT = ulid('PJ1')
const MANUAL = ulid('TX1')
const SPOKEN = ulid('TX2')
const SHOT = ulid('SH1')

const dialogue = { shotId: SHOT, lineIndex: 0, placed: { startSec: 4, durationSec: 2 } }
const clips = [
  {
    id: MANUAL,
    track: 'TEXT',
    startSec: 1,
    durationSec: 2,
    layer: 0,
    content: { type: 'text', templateKey: 'plain', params: { text: 'こんにちは', translation: 'Hello' } },
  },
  {
    id: SPOKEN,
    track: 'TEXT',
    startSec: 4,
    durationSec: 2,
    layer: 2,
    content: { type: 'text', templateKey: 'plain', params: { text: 'ねえ', dialogue } },
  },
]
const routes = [
  { method: 'GET', path: `/projects/${PROJECT}/clips`, data: clips },
  { method: 'GET', path: `/projects/${PROJECT}/text-styles`, data: [] },
]

describe('add_telops の訳文', () => {
  it('訳文を下の段として送る', async () => {
    const fake = createFakeApi([...routes, { method: 'POST', path: `/projects/${PROJECT}/clips`, status: 201, data: clips[0] }])
    await addTelopsTool.run({ projectId: PROJECT, telops: [{ text: 'こんにちは', atSec: 1, translation: 'Hello' }] }, depsFor(fake))
    expect(fake.callsTo('POST', `/projects/${PROJECT}/clips`)[0]?.body).toMatchObject({
      content: { params: { text: 'こんにちは', translation: 'Hello' } },
    })
  })

  it('長すぎる訳文は送る前に断る', async () => {
    const fake = createFakeApi(routes)
    const result = await addTelopsTool.run({ projectId: PROJECT, telops: [{ text: 'x', atSec: 0, translation: 'a'.repeat(401) }] }, depsFor(fake))
    expect(result.isError).toBe(true)
    expect(fake.callsTo('POST', /clips/)).toHaveLength(0)
  })
})

describe('list_telops', () => {
  it('セリフの字幕は origin が dialogue。訳文も返す', async () => {
    const fake = createFakeApi(routes)
    const result = jsonOf(await listTelopsTool.run({ projectId: PROJECT }, depsFor(fake))) as {
      telops: { id: string; origin: string; translation?: string }[]
    }
    expect(result.telops.map((t) => [t.id, t.origin, t.translation ?? null])).toEqual([
      [MANUAL, 'manual', 'Hello'],
      [SPOKEN, 'dialogue', null],
    ])
  })
})

describe('edit_clips の訳文', () => {
  it('セリフの字幕の訳文を送る（印は残す）', async () => {
    const fake = createFakeApi([...routes, { method: 'PATCH', path: `/clips/${SPOKEN}`, data: clips[1] }])
    await editClipsTool.run({ projectId: PROJECT, edits: [{ clipId: SPOKEN, translation: 'Hey.' }] }, depsFor(fake))
    expect(fake.callsTo('PATCH', `/clips/${SPOKEN}`)[0]?.body).toEqual({
      content: { type: 'text', templateKey: 'plain', params: { text: 'ねえ', dialogue, translation: 'Hey.' } },
    })
  })

  it('null で訳文を外す', async () => {
    const fake = createFakeApi([...routes, { method: 'PATCH', path: `/clips/${MANUAL}`, data: clips[0] }])
    await editClipsTool.run({ projectId: PROJECT, edits: [{ clipId: MANUAL, translation: null }] }, depsFor(fake))
    expect(fake.callsTo('PATCH', `/clips/${MANUAL}`)[0]?.body).toEqual({
      content: { type: 'text', templateKey: 'plain', params: { text: 'こんにちは' } },
    })
  })

  it('セリフの字幕の文字は Shot のセリフで直すよう断る', async () => {
    const fake = createFakeApi(routes)
    const result = await editClipsTool.run({ projectId: PROJECT, edits: [{ clipId: SPOKEN, text: 'やあ' }] }, depsFor(fake))
    expect(textOf(result)).toContain('edit_shots')
    expect(fake.callsTo('PATCH', /\/clips\//)).toHaveLength(0)
  })
})

describe('remove_telops', () => {
  it('セリフの字幕は消さずに理由を返す（消しても Shot のセリフから作り直される）', async () => {
    const fake = createFakeApi([...routes, { method: 'DELETE', path: /.*/, status: 204 }])
    const result = jsonOf(await removeTelopsTool.run({ projectId: PROJECT, clipIds: [SPOKEN] }, depsFor(fake))) as {
      failures: { id: string; reason: string }[]
    }
    expect(result.failures.map((f) => f.id)).toEqual([SPOKEN])
    expect(result.failures[0]?.reason).toContain('edit_shots')
    expect(fake.callsTo('DELETE', /.*/)).toHaveLength(0)
  })
})
