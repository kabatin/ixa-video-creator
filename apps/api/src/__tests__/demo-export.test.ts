import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { MediaAssetId as MediaAssetIdSchema, newId, type DemoManifest } from '@ixa/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDirBundleSource } from '../demo-project/bundle-source.js'
import { forbiddenWordsLine, parseExportArgs, secretsFromEnv } from '../demo-project/export-cli.js'
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
      // 置き場（`music/{作品}/{曲}/peaks.json`）の中の ID も、区間ごとに同じ番号へ（入れた作品の ID で決まる置き場になる）。
      if (node.includes('/')) return node.split('/').map((segment) => walk(segment)).join('/')
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
    // 波形は同じ中身。置き場は入れた作品の ID で決まる（作る人の作品の置き場ではない）。
    expect(second.files.map(({ sha256, sizeBytes }) => ({ sha256, sizeBytes }))).toEqual(first.files.map(({ sha256, sizeBytes }) => ({ sha256, sizeBytes })))
    expect(second.files[0]?.key).not.toBe(first.files[0]?.key)
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

describe('入れる側が断るものは書かない', () => {
  it('消した素材を指す Take があれば、件数と場所を言って止める（入れる側で外部キーに落ちない）', async () => {
    const creator = aWorld()
    const seeded = await seedCreatorProject(creator, tmp)
    await creator.mediaAssets.softDelete(seeded.media.video3)
    const out = join(tmp, 'deleted-media')
    const error: unknown = await exportToDir(creator, seeded.project, out).catch((e: unknown) => e)
    expect((error as Error).message).toMatch(/目録の外を指す値が 1 件あります: source\.shots\[1\]\.takes\[0\]\.mediaAssetId/)
    expect(await readdir(out)).toEqual([])
  }, 60_000)

  it('入れる側が受けない素材の型（SVG）があれば止める', async () => {
    const creator = aWorld()
    const seeded = await seedCreatorProject(creator, tmp)
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
    const id = newId(MediaAssetIdSchema)
    const storageKey = `media/${creator.workspaceId}/${id}/original.svg`
    await creator.storage.put(storageKey, svg, { contentType: 'image/svg+xml' })
    await creator.mediaAssets.create({
      id, workspaceId: creator.workspaceId, projectId: null, kind: 'image', storageKey, mimeType: 'image/svg+xml',
      bytes: svg.byteLength, checksumSha256: createHash('sha256').update(svg).digest('hex'), origin: { type: 'upload', uploadedBy: 'test' }, tags: [],
    })
    await creator.writers.projects.update(seeded.project.id, { styleReferenceAssetIds: [id] })
    const out = join(tmp, 'svg')
    await expect(exportToDir(creator, seeded.project, out)).rejects.toThrow('入れる側が受けない形です')
    expect(await readdir(out)).toEqual([])
  }, 60_000)
})

describe('鍵の集め方（secretsFromEnv）', () => {
  it('KEY・TOKEN・SECRET・PASSPHRASE・PASSWORD の名前の値と、URL のパスワードを集め、8 文字より短いものは数えて外す', () => {
    const { secrets, skipped } = secretsFromEnv({
      STORAGE_SIGNING_SECRET: 's'.repeat(40),
      FAL_API_KEY: 'fal-1234567890',
      VPIPE_API_TOKEN: 'tok-abcdefgh',
      IXA_PASSPHRASE: 'short',
      S3_SECRET_ACCESS_KEY: 'minio-secret-key',
      DB_PASSWORD: 'p4ssw0rd!',
      DATABASE_URL: 'postgresql://ixa:db-password-123@127.0.0.1:5432/ixa',
      REDIS_URL: 'redis://:rpw@127.0.0.1:6379',
      LOG_LEVEL: 'info',
      EMPTY_TOKEN: '',
    })
    expect([...secrets].sort()).toEqual(
      ['s'.repeat(40), 'fal-1234567890', 'tok-abcdefgh', 'minio-secret-key', 'p4ssw0rd!', 'db-password-123'].sort(),
    )
    // 短すぎて外した値: IXA_PASSPHRASE と REDIS_URL のパスワード（空は数えない）。
    expect(skipped).toBe(2)
  })
})

describe('書き出しの引数', () => {
  const ok = ['--project', '01JAAAAAAAAAAAAAAAAAAAAAAA', '--out', '/tmp/x', '--demo-key', 'ixa-demo-v1', '--base-url', 'https://github.com/o/r/releases/download/d/', '--title', '見本']

  it('全部そろえば読める（pnpm の -- が前に付いても）', () => {
    expect(parseExportArgs(['--', ...ok])).toMatchObject({ demoKey: 'ixa-demo-v1', baseUrl: 'https://github.com/o/r/releases/download/d/', title: '見本' })
  })

  it('--forbid は何度でも書け、拾ってほしい語（本名・機械の名前）になる。点検の一覧はその数と、渡したときだけ見つけることを言う', () => {
    expect(parseExportArgs(ok).forbid).toEqual([])
    expect(parseExportArgs([...ok, '--forbid', 'Taro Yamada', '--forbid', 'mac-studio']).forbid).toEqual(['Taro Yamada', 'mac-studio'])
    expect(forbiddenWordsLine(2)).toBe('作る人が渡した語 2 件も確かめました。本名・ハンドル名・機械の名前は、--forbid で渡したときだけ見つけます。')
    expect(forbiddenWordsLine(0)).toContain('--forbid')
  })

  it('渡した語が中身にあれば止める（値は言わない）', async () => {
    const creator = aWorld()
    const seeded = await seedCreatorProject(creator, tmp)
    await creator.writers.projects.update(seeded.project.id, { styleGuide: '撮影 Taro Yamada' })
    const out = join(tmp, 'forbid')
    const error: unknown = await exportToDir(creator, seeded.project, out, { extraWords: ['taro yamada'] }).catch((e: unknown) => e)
    expect((error as Error).message).toMatch(/1 件あるので、目録を書きません: source\.project\.styleGuide$/)
    expect((error as Error).message.toLowerCase()).not.toContain('taro')
  }, 60_000)

  it('キーに当たったときも、止める文にそのキーを入れない', async () => {
    const creator = aWorld()
    const seeded = await seedCreatorProject(creator, tmp)
    const [clip] = await creator.writers.timelineClips.findByProject(seeded.project.id)
    const content = clip!.content
    if (content.type !== 'text') throw new Error('テロップのはず')
    await creator.writers.timelineClips.replace([clip!.id], [{
      projectId: seeded.project.id, track: 'TEXT', startSec: 0, durationSec: 2,
      content: { ...content, params: { ...content.params, '/Users/demo-maker/secret-folder': true } },
    }])
    const out = join(tmp, 'key-hit')
    const error: unknown = await exportToDir(creator, seeded.project, out).catch((e: unknown) => e)
    expect((error as Error).message).toContain('<key>')
    expect((error as Error).message).not.toContain('secret-folder')
    expect((error as Error).message).not.toContain('demo-maker')
  }, 60_000)

  it('知らない引数・欠けた引数・https でない取りに行く先は止める', () => {
    expect(() => parseExportArgs([...ok, '--force'])).toThrow()
    expect(() => parseExportArgs(ok.slice(2))).toThrow(/projectId/)
    expect(() => parseExportArgs(ok.map((arg) => (arg === 'https://github.com/o/r/releases/download/d/' ? 'http://example.com/d/' : arg)))).toThrow(/baseUrl/)
    // どこが違うかだけでなく、決まり（github.com の下・末尾 /）も言う。
    expect(() => parseExportArgs(ok.map((arg) => (arg === 'https://github.com/o/r/releases/download/d/' ? 'https://example.com/d/' : arg)))).toThrow(/https:\/\/github\.com\//)
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
    expect(text).toContain('素材のファイルそのものの中の情報（写真の撮影情報など）は見ていません')
    expect(lines.at(-1)).toBe('上げる前に、manifest.json を一度読んでください。')
  }, 60_000)
})
