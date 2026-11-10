import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { DemoManifest } from '@ixa/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDirBundleSource } from '../demo-project/bundle-source.js'
import { parseExportArgs } from '../demo-project/export-cli.js'
import { exportReviewLines } from '../demo-project/export-review.js'
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
    expect((error as Error).message).toContain('公開できない値（鍵・署名付きの URL・この機械の場所や名前）が 1 件')
    expect((error as Error).message).toContain('source.project.avoid')
    expect((error as Error).message).not.toContain('sig=')
    expect(await readdir(out)).toEqual([])
  }, 60_000)

  it('置き場の鍵などの秘密が文に混ざっていれば止める', async () => {
    const creator = aWorld()
    const seeded = await seedCreatorProject(creator, tmp)
    const secret = 'z'.repeat(40)
    await creator.writers.projects.update(seeded.project.id, { styleGuide: `水彩 ${secret}` })
    const out = join(tmp, 'secret')
    await expect(exportToDir(creator, seeded.project, out, { secrets: [secret] })).rejects.toThrow(/が 1 件あるので、目録を書きません: source\.project\.styleGuide$/)
    expect(await readdir(out)).toEqual([])
  }, 60_000)
})

describe('機械と持ち主の情報', () => {
  it('Take の送った記録（CLI の作業フォルダ・手元のサーバ）・費用・作業名は外して書き、中身は残す', async () => {
    const creator = aWorld()
    const seeded = await seedCreatorProject(creator, tmp)
    const [take] = await creator.writers.takes.findByShot(seeded.shots.b.id)
    // 書き手の口は Take を直せないので、記録ごと差し替えた Take を作り、採用し直す。
    const cliTake = await creator.writers.takes.create({
      ...take!,
      providerParams: { kind: 'cli', command: 'codex exec', cwd: '/Users/creator/ixa', cliVersion: '1.0.0', exitCode: 0, stdoutDigest: 'f'.repeat(64) },
    })
    await creator.writers.shots.selectTake(seeded.shots.b.id, cliTake.id)
    const manifest = await exportToDir(creator, seeded.project, join(tmp, 'neutral'), { title: '公開する題' })
    const text = JSON.stringify(manifest)
    expect(text).not.toContain('/Users/creator')
    expect(text).not.toContain('作る人の作品')
    const project = manifest.source['project'] as Record<string, unknown>
    expect(project).toMatchObject({ name: '公開する題', budgetUsd: null, lyrics: '一行目', styleGuide: '水彩のアニメ調' })
    expect(manifest.media[0]).not.toHaveProperty('originalFilename')
  }, 60_000)

  it('中身の文にこの機械の場所が入っていれば止め、場所（JSON の道）だけを言う', async () => {
    const creator = aWorld()
    const seeded = await seedCreatorProject(creator, tmp)
    await creator.writers.shots.update(seeded.shots.a.id, { description: '素材は /Users/creator/Desktop/a.png から' })
    const out = join(tmp, 'local-path')
    const error: unknown = await exportToDir(creator, seeded.project, out).catch((e: unknown) => e)
    expect((error as Error).message).toMatch(/1 件あるので、目録を書きません: source\.shots\[0\]\.shot\.description$/)
    expect((error as Error).message).not.toContain('Desktop')
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

describe('書き出した後の点検の一覧', () => {
  it('Shot・Take・素材の数と大きさ、そのまま公開する文の欄の名前（値は出さない）、最後に一度読む案内', async () => {
    const creator = aWorld()
    const seeded = await seedCreatorProject(creator, tmp)
    const manifest = await exportToDir(creator, seeded.project, join(tmp, 'review'))
    const lines = exportReviewLines(manifest)
    const text = lines.join('\n')
    expect(text).toContain('Shot 2 件')
    expect(text).toContain('Take 3 件')
    expect(text).toContain(`素材のファイル ${String(manifest.media.length)} 件`)
    expect(text).toMatch(/合わせて \d+(\.\d)? (B|KB|MB)/)
    expect(text).toContain('歌詞（project.lyrics）')
    expect(text).toContain('ルック（project.styleGuide）')
    expect(text).toContain('Shot の説明（shots[].shot.description）')
    // 空の欄は挙げない・値は出さない。
    expect(text).not.toContain('避けたいもの')
    expect(text).not.toContain('一行目')
    expect(text).not.toContain('夜の街を走る')
    expect(lines.at(-1)).toBe('上げる前に、manifest.json を一度読んでください。')
  }, 60_000)
})
