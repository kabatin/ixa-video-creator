import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportThumbnailTool } from '../tools/export-thumbnail.js'
import { createFakeApi, depsFor, jsonOf, ownedMedia, textOf, ulid, type Route } from './fake-api.js'

/** サムネイルの書き出し（ADR-0051）。偽の API で、頼み方・待ち方・保存と画像の返し方を確かめる。 */

const PROJECT = ulid('PJ1')
const THUMB = ulid('TH1')
const OUTPUT = ulid('MD5')
const ASSET = ulid('MD1')
const JOB_A = ulid('KA1')
const JOB_B = ulid('KA2')
const ART_A = ulid('AA1')
const ART_B = ulid('AB1')
const FILE_NAME = 'なつ_うた サムネ 2026-10-17 12.00.00.jpg'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

const thumbRow = (status: string, outputAssetId: string | null = null, error: string | null = null) => ({
  id: THUMB,
  projectId: PROJECT,
  status,
  outputAssetId,
  fileName: FILE_NAME,
  error,
  createdAt: '2026-10-17T03:00:00Z',
  finishedAt: null,
})

const keyArtRow = (id: string, status: string, mediaAssetId: string | null) => ({
  id,
  status,
  instruction: '夕焼け',
  mediaAssetId,
  error: status === 'failed' ? '描けませんでした' : null,
  queuedAt: '2026-10-17T03:00:00Z',
  finishedAt: null,
})

/** 書き出しを受け付け、2 回目の問い合わせで終わり、JPEG を取り出せる口。 */
const doneRoutes: readonly Route[] = [
  { method: 'POST', path: `/projects/${PROJECT}/thumbnails`, status: 202, data: { thumbnailId: THUMB } },
  { method: 'GET', path: `/thumbnails/${THUMB}`, sequence: [{ data: thumbRow('rendering') }, { data: thumbRow('done', OUTPUT) }] },
  {
    method: 'GET',
    path: `/projects/${PROJECT}`,
    data: { id: PROJECT, name: 'なつ/うた', fps: 24, resolution: { width: 1920, height: 1080 }, aspectRatio: '16:9', durationSec: 60, status: 'planning' },
  },
  { method: 'GET', path: `/media/${OUTPUT}/url`, data: { url: '/files/thumb.jpg?sig=S', expiresInSec: 600 } },
  { method: 'GET', path: '/files/thumb.jpg', bytes: JPEG },
]

const imageOf = (result: CallToolResult) => result.content.find((block) => block.type === 'image')

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-mcp-thumb-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('export_thumbnail', () => {
  it('タイムラインのコマで書き出し、待って手元へ保存し、JPEG を画像として返す', async () => {
    const fake = createFakeApi(doneRoutes)
    const result = await exportThumbnailTool.run(
      { projectId: PROJECT, background: { atSec: 12.5 }, title: '新曲', layout: 'bottom', colors: { accent: '#ff0000' } },
      depsFor(fake, { outputDir: dir }),
    )
    expect(fake.callsTo('POST', `/projects/${PROJECT}/thumbnails`)[0]?.body).toMatchObject({
      // 3 マスだった頃の bottom は今の bottom_left に読み替えて送る。
      spec: { background: { kind: 'timeline_frame', atSec: 12.5 }, title: '新曲', layout: 'bottom_left', accentColor: '#ff0000' },
    })
    const data = jsonOf(result) as Record<string, string>
    expect(data).toMatchObject({ thumbnailId: THUMB, status: 'done', outputAssetId: OUTPUT, fileName: FILE_NAME })
    expect(data.filePath).toBe(join(dir, 'なつ_うた', FILE_NAME))
    expect([...(await readFile(data.filePath ?? ''))]).toEqual([...JPEG])
    expect(imageOf(result)).toEqual({ type: 'image', mimeType: 'image/jpeg', data: Buffer.from(JPEG).toString('base64') })
    // 署名付き URL は結果に出さない。
    expect(JSON.stringify(result)).not.toContain('sig=S')
  })

  it('素材の画像を背景にできる', async () => {
    const fake = createFakeApi([...doneRoutes, ownedMedia(PROJECT)])
    jsonOf(
      await exportThumbnailTool.run(
        { projectId: PROJECT, background: { mediaAssetId: ASSET }, title: '新曲', zoom: 1.5, focusX: 0.2 },
        depsFor(fake, { outputDir: dir }),
      ),
    )
    expect(fake.callsTo('POST', `/projects/${PROJECT}/thumbnails`)[0]?.body).toMatchObject({
      spec: { background: { kind: 'image', mediaAssetId: ASSET }, zoom: 1.5, focusX: 0.2 },
    })
  })

  it('キーアートは候補を 2 枚頼んで待ち、candidateIndex の候補で書き出す。候補を全部返す', async () => {
    const fake = createFakeApi([
      ...doneRoutes,
      { method: 'POST', path: `/projects/${PROJECT}/key-art/generate`, status: 202, data: { jobIds: [JOB_A, JOB_B] } },
      {
        method: 'GET',
        path: `/projects/${PROJECT}/key-art`,
        sequence: [
          { data: [keyArtRow(JOB_B, 'running', null), keyArtRow(JOB_A, 'succeeded', ART_A)] },
          { data: [keyArtRow(JOB_B, 'succeeded', ART_B), keyArtRow(JOB_A, 'succeeded', ART_A)] },
        ],
      },
    ])
    const result = await exportThumbnailTool.run(
      { projectId: PROJECT, background: { keyArt: { instruction: '夕焼けの屋上' } }, candidateIndex: 1, title: '新曲' },
      depsFor(fake, { outputDir: dir }),
    )
    expect(fake.callsTo('POST', `/projects/${PROJECT}/key-art/generate`)[0]?.body).toEqual({ count: 2, instruction: '夕焼けの屋上' })
    expect(fake.callsTo('POST', `/projects/${PROJECT}/thumbnails`)[0]?.body).toMatchObject({
      spec: { background: { kind: 'image', mediaAssetId: ART_B } },
    })
    expect(jsonOf(result)).toMatchObject({ status: 'done', keyArtJobIds: [JOB_A, JOB_B], keyArtCandidates: [ART_A, ART_B] })
  })

  it('選んだ候補が無ければ、失敗の理由つきで止め、書き出さない', async () => {
    const fake = createFakeApi([
      ...doneRoutes,
      { method: 'GET', path: `/projects/${PROJECT}/key-art`, data: [keyArtRow(JOB_A, 'succeeded', ART_A), keyArtRow(JOB_B, 'failed', null)] },
    ])
    const result = await exportThumbnailTool.run(
      { projectId: PROJECT, background: { keyArt: { jobIds: [JOB_A, JOB_B] } }, candidateIndex: 1, title: '新曲' },
      depsFor(fake, { outputDir: dir }),
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('描けませんでした')
    expect(fake.callsTo('POST', `/projects/${PROJECT}/thumbnails`)).toHaveLength(0)
  })

  it('この作品のキーアートに無いジョブ ID は、待たずに理由つきで止める', async () => {
    const fake = createFakeApi([
      ...doneRoutes,
      { method: 'GET', path: `/projects/${PROJECT}/key-art`, data: [keyArtRow(JOB_A, 'running', null)] },
    ])
    const result = await exportThumbnailTool.run(
      { projectId: PROJECT, background: { keyArt: { jobIds: [JOB_A, JOB_B] } }, title: '新曲', waitSec: 120 },
      depsFor(fake, { outputDir: dir }),
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain(JOB_B)
    // 時間切れまで問い合わせ続けない（最初の 1 回で分かる）。
    expect(fake.callsTo('GET', `/projects/${PROJECT}/key-art`)).toHaveLength(1)
    expect(fake.callsTo('POST', `/projects/${PROJECT}/thumbnails`)).toHaveLength(0)
  })

  it('別の名前の 2 枚は別のファイルに保存する（前の 1 枚を返さない）', async () => {
    const THUMB_2 = ulid('TH2')
    const OUTPUT_2 = ulid('MD6')
    const JPEG_2 = new Uint8Array([0xff, 0xd8, 0x00, 0xff, 0xd9])
    const second = { ...thumbRow('done', OUTPUT_2), id: THUMB_2, fileName: 'なつ_うた サムネ 2026-10-17 12.00.00 zz9999.jpg' }
    const fake = createFakeApi([
      ...doneRoutes,
      { method: 'GET', path: `/thumbnails/${THUMB_2}`, data: second },
      { method: 'GET', path: `/projects/${PROJECT}/thumbnails`, data: [{ id: THUMB }, { id: THUMB_2 }] },
      { method: 'GET', path: `/media/${OUTPUT_2}/url`, data: { url: '/files/thumb2.jpg?sig=T', expiresInSec: 600 } },
      { method: 'GET', path: '/files/thumb2.jpg', bytes: JPEG_2 },
    ])
    const deps = depsFor(fake, { outputDir: dir })
    const first = jsonOf(await exportThumbnailTool.run({ projectId: PROJECT, background: { atSec: 1 }, title: '新曲' }, deps)) as Record<string, string>
    const other = jsonOf(await exportThumbnailTool.run({ projectId: PROJECT, thumbnailId: THUMB_2 }, deps)) as Record<string, string>
    expect(other.filePath).not.toBe(first.filePath)
    expect([...(await readFile(other.filePath ?? ''))]).toEqual([...JPEG_2])
    expect([...(await readFile(first.filePath ?? ''))]).toEqual([...JPEG])
  })

  it('大きさ・副題の色・差し色のバー・9 マスの配置をそのまま送る', async () => {
    const fake = createFakeApi(doneRoutes)
    jsonOf(
      await exportThumbnailTool.run(
        {
          projectId: PROJECT,
          background: { atSec: 1 },
          title: '新曲',
          layout: 'top_center',
          titleSize: 160,
          subtitleSize: 90,
          accentBar: false,
          colors: { subtitle: '#00ff88' },
        },
        depsFor(fake, { outputDir: dir }),
      ),
    )
    expect(fake.callsTo('POST', `/projects/${PROJECT}/thumbnails`)[0]?.body).toMatchObject({
      spec: { layout: 'top_center', titleSize: 160, subtitleSize: 90, accentBar: false, subtitleColor: '#00ff88' },
    })
  })

  it('範囲の外の大きさ・形の違う副題の色は、API を呼ぶ前に項目の名前つきで断る', async () => {
    for (const patch of [{ titleSize: 27 }, { titleSize: 201 }, { subtitleSize: 19 }, { subtitleSize: 121 }, { colors: { subtitle: 'white' } }]) {
      const fake = createFakeApi(doneRoutes)
      const result = await exportThumbnailTool.run({ projectId: PROJECT, background: { atSec: 1 }, title: '新曲', ...patch }, depsFor(fake, { outputDir: dir }))
      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/titleSize|subtitleSize|subtitleColor/)
      expect(fake.calls).toHaveLength(0)
    }
  })

  it('41 字の題名は API を呼ぶ前に断る（キーアートも頼まない）', async () => {
    const fake = createFakeApi(doneRoutes)
    const result = await exportThumbnailTool.run(
      { projectId: PROJECT, background: { keyArt: {} }, title: 'あ'.repeat(41) },
      depsFor(fake, { outputDir: dir }),
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('題名')
    expect(fake.calls).toHaveLength(0)
  })

  it('背景は 1 つだけ', async () => {
    const fake = createFakeApi(doneRoutes)
    const result = await exportThumbnailTool.run(
      { projectId: PROJECT, background: { atSec: 1, mediaAssetId: ASSET }, title: '新曲' },
      depsFor(fake, { outputDir: dir }),
    )
    expect(textOf(result)).toContain('background')
    expect(fake.calls).toHaveLength(0)
  })

  it('waitSec で終わらなければ timedOut と ID を返し、thumbnailId で続きを待てる', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/projects/${PROJECT}/thumbnails`, status: 202, data: { thumbnailId: THUMB } },
      { method: 'GET', path: `/thumbnails/${THUMB}`, data: thumbRow('rendering') },
    ])
    const deps = depsFor(fake, { outputDir: dir })
    const first = jsonOf(await exportThumbnailTool.run({ projectId: PROJECT, background: { atSec: 0 }, title: '新曲', waitSec: 10 }, deps))
    expect(first).toMatchObject({ thumbnailId: THUMB, status: 'rendering', timedOut: true })

    const again = createFakeApi([
      { method: 'GET', path: `/thumbnails/${THUMB}`, data: thumbRow('failed', null, '描けませんでした') },
      { method: 'GET', path: `/projects/${PROJECT}/thumbnails`, data: [{ id: THUMB }] },
    ])
    const second = jsonOf(await exportThumbnailTool.run({ projectId: PROJECT, thumbnailId: THUMB, waitSec: 0 }, depsFor(again)))
    expect(second).toMatchObject({ thumbnailId: THUMB, status: 'failed', error: '描けませんでした' })
    expect(again.callsTo('POST', /thumbnails/)).toHaveLength(0)
  })

  it('キーアートが waitSec で描き終わらなければ、ジョブの ID を返して書き出さない', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/projects/${PROJECT}/key-art/generate`, status: 202, data: { jobIds: [JOB_A, JOB_B] } },
      { method: 'GET', path: `/projects/${PROJECT}/key-art`, data: [keyArtRow(JOB_A, 'running', null), keyArtRow(JOB_B, 'queued', null)] },
    ])
    const result = jsonOf(
      await exportThumbnailTool.run({ projectId: PROJECT, background: { keyArt: {} }, title: '新曲', waitSec: 30 }, depsFor(fake)),
    )
    expect(result).toMatchObject({ timedOut: true, keyArtJobIds: [JOB_A, JOB_B], keyArtCandidates: [] })
    expect(fake.callsTo('POST', `/projects/${PROJECT}/thumbnails`)).toHaveLength(0)
  })

  it('別の作品のサムネイル・素材は読まず・作らずに断る', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}/thumbnails`, data: [] },
      ownedMedia(ulid('PJ2')),
      { method: 'GET', path: /^\/thumbnails\//, data: thumbRow('done', OUTPUT) },
    ])
    const deps = depsFor(fake, { outputDir: dir })
    expect(textOf(await exportThumbnailTool.run({ projectId: PROJECT, thumbnailId: THUMB }, deps))).toContain(THUMB)
    expect(textOf(await exportThumbnailTool.run({ projectId: PROJECT, background: { mediaAssetId: ASSET }, title: '新曲' }, deps))).toContain(ASSET)
    expect(fake.callsTo('GET', /^\/thumbnails\//)).toHaveLength(0)
    expect(fake.callsTo('POST', /.*/)).toHaveLength(0)
  })
})
