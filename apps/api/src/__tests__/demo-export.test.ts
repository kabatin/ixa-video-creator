import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { DemoManifest } from '@ixa/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDirBundleSource } from '../demo-project/bundle-source.js'
import { parseExportArgs } from '../demo-project/export-cli.js'
import { createDemoInstaller } from '../demo-project/installer.js'
import { createLogger } from '../logger.js'
import { aWorld, exportToDir, makeTempDir, removeDir, seedCreatorProject } from './demo-fixtures.js'

/**
 * 見本の目録を書き出す（作る人の道具。ADR-0067）。
 * 見たいのは、**書き出して入れ直すと同じ作品になる**ことと、**秘密・欠けたファイルのある目録は書かない**こと。
 */

let tmp: string
beforeAll(async () => {
  tmp = await makeTempDir()
})
afterAll(async () => {
  await removeDir(tmp)
})

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i
/** 入れ直すと必ず変わるもの（作った日時・複製の印・作り直したハッシュ・決め直す状態・作品の名前と見本の印）。 */
const VARYING_KEYS = new Set(['createdAt', 'updatedAt', 'copiedFromTakeId', 'specHash', 'status', 'demoKey'])

/** ID を出てきた順の番号に置き換える（指し合いの形は残す）。必ず変わる列は外す。 */
const normalize = (value: unknown): unknown => {
  const ordinals = new Map<string, string>()
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      if (!ULID.test(node)) return node
      const known = ordinals.get(node) ?? `#${String(ordinals.size + 1)}`
      ordinals.set(node, known)
      return known
    }
    if (Array.isArray(node)) return node.map(walk)
    if (typeof node === 'object' && node !== null) {
      return Object.fromEntries(Object.entries(node).filter(([key]) => !VARYING_KEYS.has(key)).map(([key, item]) => [key, walk(item)]))
    }
    return node
  }
  return walk(value)
}

/** 作品の名前（目録の題）と、声の Take の出自（写すと「写したもの」になる。ADR-0038）も、入れ直すと変わる。 */
const comparable = (manifest: DemoManifest): Record<string, unknown> => {
  const project = manifest.source['project'] as Record<string, unknown>
  const takes = manifest.source['narrationTakes'] as readonly Record<string, unknown>[]
  return {
    ...manifest.source,
    project: { ...project, name: '（名前）' },
    narrationTakes: takes.map((take) => Object.fromEntries(Object.entries(take).filter(([key]) => key !== 'source'))),
  }
}

describe('書き出して入れ直す', () => {
  it('入れた作品をもう一度書き出すと、ID の他は同じ中身になる', async () => {
    const creator = aWorld()
    const seeded = await seedCreatorProject(creator, tmp)
    const first = await exportToDir(creator, seeded.project, join(tmp, 'first'))
    expect(first.media).toHaveLength(Object.keys(seeded.media).length)
    expect(first.files.map((file) => file.key)).toEqual([seeded.peaksKey])

    const user = aWorld()
    const installer = createDemoInstaller({
      bundle: createDirBundleSource(join(tmp, 'first')),
      projects: user.writers.projects,
      mediaAssets: user.mediaAssets,
      storage: user.storage,
      writers: user.writers,
      logger: createLogger('silent'),
    })
    const { project } = await installer.install(user.workspaceId)
    const second = await exportToDir(user, project, join(tmp, 'second'))

    expect(normalize(comparable(second))).toEqual(normalize(comparable(first)))
    expect(second.media.map((entry) => entry.sha256).sort()).toEqual(first.media.map((entry) => entry.sha256).sort())
    expect(second.files).toEqual(first.files)
  }, 60_000)
})

describe('書かない目録', () => {
  it('素材の元のファイルが欠けていれば止め、何も書かない', async () => {
    const creator = aWorld()
    const seeded = await seedCreatorProject(creator, tmp)
    const missing = await creator.mediaAssets.findById(seeded.media.video3)
    await creator.storage.delete(missing!.storageKey)
    const out = join(tmp, 'missing')
    await expect(exportToDir(creator, seeded.project, out)).rejects.toThrow(`素材 ${seeded.media.video3} の元のファイルが置き場にありません`)
    expect(await readdir(out)).toEqual([])
  }, 60_000)

  it('署名付きの URL・渡した鍵が中身に入っていれば止め、何も書かない（値は言わない）', async () => {
    const creator = aWorld()
    const seeded = await seedCreatorProject(creator, tmp)
    const signed = 'http://127.0.0.1:3001/files/media/x/original.mp4?exp=1&sig=abcdef'
    await creator.writers.projects.update(seeded.project.id, { avoid: signed })
    const out = join(tmp, 'signed')
    const error: unknown = await exportToDir(creator, seeded.project, out).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('署名付きの URL か鍵に見える値が 1 件')
    expect((error as Error).message).not.toContain('sig=')
    expect(await readdir(out)).toEqual([])
  }, 60_000)

  it('置き場の鍵などの秘密が文に混ざっていれば止める', async () => {
    const creator = aWorld()
    const seeded = await seedCreatorProject(creator, tmp)
    const secret = 'z'.repeat(40)
    await creator.writers.projects.update(seeded.project.id, { styleGuide: `水彩 ${secret}` })
    const out = join(tmp, 'secret')
    await expect(exportToDir(creator, seeded.project, out, { secrets: [secret] })).rejects.toThrow('署名付きの URL か鍵に見える値が 1 件')
    expect(await readdir(out)).toEqual([])
  }, 60_000)
})

describe('書き出しの引数', () => {
  const ok = ['--project', '01JAAAAAAAAAAAAAAAAAAAAAAA', '--out', '/tmp/x', '--demo-key', 'ixa-demo-v1', '--base-url', 'https://example.com/d/', '--title', '見本']

  it('全部そろえば読める（pnpm の -- が前に付いても）', () => {
    expect(parseExportArgs(['--', ...ok])).toMatchObject({ demoKey: 'ixa-demo-v1', baseUrl: 'https://example.com/d/', title: '見本' })
  })

  it('知らない引数・欠けた引数・https でない取りに行く先は止める', () => {
    expect(() => parseExportArgs([...ok, '--force'])).toThrow()
    expect(() => parseExportArgs(ok.slice(2))).toThrow(/projectId/)
    expect(() => parseExportArgs(ok.map((arg) => (arg === 'https://example.com/d/' ? 'http://example.com/d/' : arg)))).toThrow(/baseUrl/)
  })
})
