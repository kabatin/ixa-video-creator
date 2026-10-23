import { describe, expect, it } from 'vitest'
import { editClipsTool } from '../tools/edit-clips.js'
import { addTelopsTool, listTelopsTool, removeTelopsTool } from '../tools/telops.js'
import { createFakeApi, depsFor, jsonOf, textOf, ulid } from './fake-api.js'

/** テロップを置く・直す・消す。中身は丸ごと差し替わるので、今の中身に変えた欄だけを重ねて送る。 */

const PROJECT = ulid('PJ1')
const STYLE = ulid('ST1')
const TEXT = ulid('TX1')
const NARRATED = ulid('TX2')
const SOUND = ulid('SD1')
const EFFECT = ulid('FX1')
const LINE = ulid('NN1')
const MEDIA = ulid('MD1')
const FOREIGN = ulid('ZZ9')

const styles = [{ id: STYLE, name: '歌詞', style: { color: '#FFCC00', size: 0.08 } }]
const clips = [
  {
    id: TEXT,
    track: 'TEXT',
    startSec: 1,
    durationSec: 2,
    layer: 0,
    content: { type: 'text', templateKey: 'plain', params: { text: 'こんにちは', style: { color: '#FFFFFF' }, lyricLine: 0 } },
  },
  {
    id: NARRATED,
    track: 'TEXT',
    startSec: 5,
    durationSec: 2,
    layer: 2,
    content: { type: 'text', templateKey: 'lower_third', params: { text: '語り', narrationLineId: LINE } },
  },
  { id: SOUND, track: 'SFX', startSec: 3, durationSec: 1, content: { type: 'media', mediaAssetId: MEDIA, inSec: 0.5, outSec: 1.5, volume: 0.8 } },
  { id: EFFECT, track: 'VFX', startSec: 0, durationSec: 0.5, content: { type: 'motion_graphics', templateKey: 'flash', params: {} } },
]
const routes = [
  { method: 'GET', path: `/projects/${PROJECT}/clips`, data: clips },
  { method: 'GET', path: `/projects/${PROJECT}/text-styles`, data: styles },
]

describe('add_telops', () => {
  it('保存したスタイルに上書きを重ね、styleId と一緒に TEXT 段へ置く', async () => {
    const fake = createFakeApi([
      ...routes,
      { method: 'POST', path: `/projects/${PROJECT}/clips`, status: 201, data: { ...clips[0], id: ulid('NEW') } },
    ])
    const result = jsonOf(
      await addTelopsTool.run(
        { projectId: PROJECT, telops: [{ text: 'タイトル', atSec: 0.5, styleName: '歌詞', style: { anchor: 'top-center' } }] },
        depsFor(fake),
      ),
    ) as { created: unknown[] }
    expect(fake.callsTo('POST', `/projects/${PROJECT}/clips`)[0]?.body).toEqual({
      track: 'TEXT',
      startSec: 0.5,
      durationSec: 2,
      layer: 0,
      content: {
        type: 'text',
        templateKey: 'plain',
        params: { text: 'タイトル', style: { color: '#FFCC00', size: 0.08, anchor: 'top-center' }, styleId: STYLE },
      },
    })
    expect(result.created).toHaveLength(1)
  })

  it('無いスタイル名は使える名前を添えて断り、何も置かない', async () => {
    const fake = createFakeApi(routes)
    const result = await addTelopsTool.run({ projectId: PROJECT, telops: [{ text: 'x', atSec: 0, styleName: '無い' }] }, depsFor(fake))
    expect(textOf(result)).toContain('あるもの: 歌詞')
    expect(fake.callsTo('POST', `/projects/${PROJECT}/clips`)).toHaveLength(0)
  })

  it('範囲外の見た目（大きさ 0.5）と短すぎる尺は送る前に断る', async () => {
    const fake = createFakeApi(routes)
    const big = await addTelopsTool.run({ projectId: PROJECT, telops: [{ text: 'x', atSec: 0, style: { size: 0.5 } }] }, depsFor(fake))
    const short = await addTelopsTool.run({ projectId: PROJECT, telops: [{ text: 'x', atSec: 0, durationSec: 0.1 }] }, depsFor(fake))
    expect(big.isError).toBe(true)
    expect(short.isError).toBe(true)
    expect(fake.calls).toHaveLength(0)
  })
})

describe('list_telops', () => {
  it('テロップだけを、どこから来たかとスタイル名つきで返す', async () => {
    const fake = createFakeApi(routes)
    const result = jsonOf(await listTelopsTool.run({ projectId: PROJECT }, depsFor(fake))) as { telops: { id: string; origin: string }[] }
    expect(result.telops.map((t) => [t.id, t.origin])).toEqual([
      [TEXT, 'lyrics'],
      [NARRATED, 'narration'],
    ])
  })
})

describe('edit_clips', () => {
  it('テロップの文字と見た目の一部だけを変え、ほかの印と見た目は残す', async () => {
    const fake = createFakeApi([...routes, { method: 'PATCH', path: `/clips/${TEXT}`, data: clips[0] }])
    jsonOf(
      await editClipsTool.run(
        { projectId: PROJECT, edits: [{ clipId: TEXT, text: 'やあ', style: { anchor: 'bottom-left' }, startSec: 1.25 }] },
        depsFor(fake),
      ),
    )
    expect(fake.callsTo('PATCH', `/clips/${TEXT}`)[0]?.body).toEqual({
      startSec: 1.25,
      content: {
        type: 'text',
        templateKey: 'plain',
        params: { text: 'やあ', style: { color: '#FFFFFF', anchor: 'bottom-left' }, lyricLine: 0 },
      },
    })
  })

  it('音のクリップの音量と尺を変えると、尺も送り終点を揃える', async () => {
    const fake = createFakeApi([...routes, { method: 'PATCH', path: `/clips/${SOUND}`, data: clips[2] }])
    jsonOf(await editClipsTool.run({ projectId: PROJECT, edits: [{ clipId: SOUND, volume: 1.2, durationSec: 0.75 }] }, depsFor(fake)))
    expect(fake.callsTo('PATCH', `/clips/${SOUND}`)[0]?.body).toEqual({
      durationSec: 0.75,
      content: { type: 'media', mediaAssetId: MEDIA, inSec: 0.5, outSec: 1.25, volume: 1.2 },
    })
  })

  it('種類に合わない欄・ナレーションのテロップの文字・変える欄なしは断り、1 件も送らない', async () => {
    const fake = createFakeApi(routes)
    const cases = [
      [{ clipId: EFFECT, volume: 1 }, '音のクリップにだけ'],
      [{ clipId: SOUND, text: 'x' }, 'テロップにだけ'],
      [{ clipId: NARRATED, text: 'x' }, 'set_narration'],
      [{ clipId: TEXT }, '変える欄がありません'],
    ] as const
    for (const [edit, message] of cases) {
      const result = await editClipsTool.run({ projectId: PROJECT, edits: [{ clipId: TEXT, startSec: 2 }, edit] }, depsFor(fake))
      expect(textOf(result)).toContain(message)
    }
    expect(fake.callsTo('PATCH', /\/clips\//)).toHaveLength(0)
  })

  it('この作品に無いクリップが 1 つでもあれば、1 件も送らない', async () => {
    const fake = createFakeApi([...routes, { method: 'PATCH', path: /\/clips\//, data: clips[0] }])
    const result = await editClipsTool.run(
      { projectId: PROJECT, edits: [{ clipId: TEXT, startSec: 4 }, { clipId: FOREIGN, startSec: 1 }] },
      depsFor(fake),
    )
    expect(textOf(result)).toContain(`この作品に無いクリップです: ${FOREIGN}`)
    expect(fake.callsTo('PATCH', /\/clips\//)).toHaveLength(0)
  })

  it('音量 3 は範囲外で断る', async () => {
    const fake = createFakeApi(routes)
    const result = await editClipsTool.run({ projectId: PROJECT, edits: [{ clipId: SOUND, volume: 3 }] }, depsFor(fake))
    expect(result.isError).toBe(true)
    expect(fake.calls).toHaveLength(0)
  })
})

describe('remove_telops', () => {
  it('テロップと行を消し、テロップ以外のクリップは理由を添えて断る', async () => {
    const fake = createFakeApi([
      ...routes,
      { method: 'GET', path: `/projects/${PROJECT}/narration`, data: { lines: [{ id: LINE }] } },
      { method: 'DELETE', path: `/clips/${TEXT}`, status: 204 },
      { method: 'DELETE', path: `/narration-lines/${LINE}`, status: 204 },
    ])
    const result = jsonOf(
      await removeTelopsTool.run({ projectId: PROJECT, clipIds: [TEXT, SOUND], narrationLineIds: [LINE] }, depsFor(fake)),
    ) as { removedClips: string[]; removedLines: string[]; failures: { id: string }[] }
    expect(result.removedClips).toEqual([TEXT])
    expect(result.removedLines).toEqual([LINE])
    expect(result.failures.map((f) => f.id)).toEqual([SOUND])
    expect(fake.callsTo('DELETE', `/clips/${SOUND}`)).toHaveLength(0)
  })

  it('この作品に無いクリップ・行が 1 つでもあれば、何も消さずに断る', async () => {
    const fake = createFakeApi([
      ...routes,
      { method: 'GET', path: `/projects/${PROJECT}/narration`, data: { lines: [{ id: LINE }] } },
      { method: 'DELETE', path: /.*/, status: 204 },
    ])
    const clip = await removeTelopsTool.run({ projectId: PROJECT, clipIds: [TEXT, FOREIGN] }, depsFor(fake))
    const line = await removeTelopsTool.run({ projectId: PROJECT, clipIds: [TEXT], narrationLineIds: [LINE, FOREIGN] }, depsFor(fake))
    expect(textOf(clip)).toContain(`この作品に無いクリップです: ${FOREIGN}`)
    expect(textOf(line)).toContain(`この作品に無いナレーションの行です: ${FOREIGN}`)
    expect(fake.callsTo('DELETE', /.*/)).toHaveLength(0)
  })

  it('何も指定しなければ断る', async () => {
    const fake = createFakeApi(routes)
    const result = await removeTelopsTool.run({ projectId: PROJECT }, depsFor(fake))
    expect(textOf(result)).toContain('1 つ以上')
  })
})
