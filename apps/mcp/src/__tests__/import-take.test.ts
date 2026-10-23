import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importTakeTool } from '../tools/import-take.js'
import { createFakeApi, depsFor, jsonOf, ownedShots, takeRow, textOf, ulid } from './fake-api.js'

const PROJECT = ulid('PJ1')
const SHOT = ulid('SH1')
const MEDIA = ulid('MD1')
const TAKE = ulid('TK1')

const owned = ownedShots(PROJECT, [SHOT])

describe('import_take', () => {
  it('動画を上げてから Shot の Take にする（採用はしない・署名は返さない）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ixa-mcp-take-'))
    const file = join(dir, 'clip.mp4')
    await writeFile(file, Buffer.from('fake mp4'))
    const fake = createFakeApi([
      owned,
      { method: 'POST', path: '/uploads/sign', data: { mediaAssetId: MEDIA, storageKey: 'k', uploadUrl: 'http://storage.test/files/k?sig=S' } },
      { method: 'PUT', path: '/files/k', data: {} },
      { method: 'POST', path: '/uploads/complete', data: { id: MEDIA } },
      { method: 'POST', path: `/shots/${SHOT}/takes/import`, status: 201, data: { ...takeRow(TAKE, null, null), mediaAssetId: MEDIA } },
    ])
    try {
      const result = jsonOf(await importTakeTool.run({ projectId: PROJECT, shotId: SHOT, filePath: file, sourceModel: 'Kling' }, depsFor(fake)))
      expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        `GET /projects/${PROJECT}/shots`,
        'POST /uploads/sign',
        'PUT /files/k',
        'POST /uploads/complete',
        `POST /shots/${SHOT}/takes/import`,
      ])
      expect(fake.calls[1]?.body).toMatchObject({ kind: 'video', contentType: 'video/mp4', fileName: 'clip.mp4' })
      expect(fake.calls[4]?.body).toEqual({ mediaAssetId: MEDIA, sourceModel: 'Kling', fileName: 'clip.mp4' })
      expect(result).toEqual({ shotId: SHOT, takeId: TAKE, index: 2, durationSec: 5.125, mediaAssetId: MEDIA })
      expect(fake.callsTo('POST', /select-take/)).toHaveLength(0)
      expect(JSON.stringify(result)).not.toContain('sig=S')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('別の作品の Shot には上げる前に断る', async () => {
    const fake = createFakeApi([ownedShots(PROJECT, [ulid('SH2')])])
    const result = await importTakeTool.run({ projectId: PROJECT, shotId: SHOT, filePath: '/tmp/clip.mp4' }, depsFor(fake))
    expect(textOf(result)).toContain(SHOT)
    expect(fake.calls).toHaveLength(1)
  })

  it('動画でないファイルは上げる前に断る', async () => {
    const fake = createFakeApi([owned])
    const result = await importTakeTool.run({ projectId: PROJECT, shotId: SHOT, filePath: '/tmp/a.png' }, depsFor(fake))
    expect(textOf(result)).toContain('video ではありません')
    expect(fake.callsTo('POST', /.*/)).toHaveLength(0)
  })
})
