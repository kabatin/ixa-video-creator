import { describe, expect, it } from 'vitest'
import { editClipsTool } from '../tools/edit-clips.js'
import { addTelopsTool } from '../tools/telops.js'
import { createFakeApi, depsFor, ulid } from './fake-api.js'

/** テロップの箱の余白（style.marginX / marginY / paddingX / paddingY）を MCP から当てる。範囲の外は送る前に断る。 */

const PROJECT = ulid('PJ1')
const TELOP = ulid('TX1')

const clip = {
  id: TELOP,
  track: 'TEXT',
  startSec: 1,
  durationSec: 2,
  layer: 0,
  content: { type: 'text', templateKey: 'plain', params: { text: 'ねえ', style: { size: 0.05 } } },
}
const routes = [
  { method: 'GET', path: `/projects/${PROJECT}/clips`, data: [clip] },
  { method: 'GET', path: `/projects/${PROJECT}/text-styles`, data: [] },
]
const BOX = { marginX: 0.05, marginY: 0.1, paddingX: 0.3, paddingY: 0.2 }

describe('add_telops の余白', () => {
  it('余白を見た目として送る', async () => {
    const fake = createFakeApi([...routes, { method: 'POST', path: `/projects/${PROJECT}/clips`, status: 201, data: clip }])
    await addTelopsTool.run({ projectId: PROJECT, telops: [{ text: 'ねえ', atSec: 1, style: BOX }] }, depsFor(fake))
    expect(fake.callsTo('POST', `/projects/${PROJECT}/clips`)[0]?.body).toMatchObject({
      content: { params: { text: 'ねえ', style: BOX } },
    })
  })

  it.each([
    ['左右の余白が大きすぎる', { marginX: 0.41 }],
    ['上下の余白が負', { marginY: -0.1 }],
    ['内側の余白が大きすぎる', { paddingX: 2.1 }],
    ['知らない項目', { marginBottom: 0.1 }],
  ])('%s は送る前に断る', async (_label, style) => {
    const fake = createFakeApi(routes)
    const result = await addTelopsTool.run({ projectId: PROJECT, telops: [{ text: 'ねえ', atSec: 0, style }] }, depsFor(fake))
    expect(result.isError).toBe(true)
    expect(fake.callsTo('POST', /clips/)).toHaveLength(0)
  })
})

describe('edit_clips の余白', () => {
  it('変えた余白だけ重ね、ほかの見た目は残す', async () => {
    const fake = createFakeApi([...routes, { method: 'PATCH', path: `/clips/${TELOP}`, data: clip }])
    await editClipsTool.run({ projectId: PROJECT, edits: [{ clipId: TELOP, style: { paddingX: 0.3 } }] }, depsFor(fake))
    expect(fake.callsTo('PATCH', `/clips/${TELOP}`)[0]?.body).toMatchObject({
      content: { params: { text: 'ねえ', style: { size: 0.05, paddingX: 0.3 } } },
    })
  })

  it('unsetStyle で余白を型の既定に戻せる', async () => {
    const withBox = { ...clip, content: { ...clip.content, params: { text: 'ねえ', style: { size: 0.05, marginX: 0.05 } } } }
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}/clips`, data: [withBox] },
      { method: 'GET', path: `/projects/${PROJECT}/text-styles`, data: [] },
      { method: 'PATCH', path: `/clips/${TELOP}`, data: clip },
    ])
    await editClipsTool.run({ projectId: PROJECT, edits: [{ clipId: TELOP, unsetStyle: ['marginX'] }] }, depsFor(fake))
    expect(fake.callsTo('PATCH', `/clips/${TELOP}`)[0]?.body).toMatchObject({
      content: { params: { text: 'ねえ', style: { size: 0.05 } } },
    })
  })
})
