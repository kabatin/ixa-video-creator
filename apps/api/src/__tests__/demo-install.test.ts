import { readFile, writeFile } from 'node:fs/promises'
import { waveformKey } from '@ixa/storage'
import { join } from 'node:path'
import {
  MediaAssetId as MediaAssetIdSchema,
  demoBindingProblems,
  newId,
  remapExactValues,
  type DemoManifest,
  type MediaAssetId,
  type ProjectDemoKey,
} from '@ixa/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDirBundleSource, type DemoBundleSource } from '../demo-project/bundle-source.js'
import {
  DemoFileError,
  DemoManifestError,
  DemoUnavailableError,
  DemoWorkspaceMissingError,
  demoFailureMessage,
  demoFailureReason,
} from '../demo-project/errors.js'
import { createDemoInstaller, type DemoInstallerDeps } from '../demo-project/installer.js'
import type { MediaQueue } from '../media-intake.js'
import { createLogger } from '../logger.js'
import {
  aWorld,
  exportToDir,
  makeTempDir,
  removeDir,
  seedCreatorProject,
  sha256Of,
  type CreatorProject,
  type DemoWorld,
} from './demo-fixtures.js'

/**
 * 同梱の見本を入れる（ADR-0067）。作る人の機械で書き出した目録とファイル（`DEMO_DIR` の形）を、
 * 別の機械（別のリポジトリと置き場）に入れる。
 * 見たいのは、**押すだけで中身のそろった作品が 1 つだけでき、壊れたものは何も入れない**こと。
 */

let tmp: string
let bundleDir: string
let manifest: DemoManifest
let creator: DemoWorld
let seeded: CreatorProject

beforeAll(async () => {
  tmp = await makeTempDir()
  creator = aWorld()
  seeded = await seedCreatorProject(creator, tmp)
  bundleDir = join(tmp, 'bundle')
  manifest = await exportToDir(creator, seeded.project, bundleDir)
}, 60_000)

afterAll(async () => {
  await removeDir(tmp)
})

/** 取りに行った数を数える出どころ。 */
const counting = (source: DemoBundleSource) => {
  const fetched: string[] = []
  return {
    fetched,
    source: {
      manifest: source.manifest,
      fetchFile: async (m: DemoManifest, entry: Parameters<DemoBundleSource['fetchFile']>[1]) => {
        fetched.push(entry.file)
        return source.fetchFile(m, entry)
      },
    } satisfies DemoBundleSource,
  }
}

const recordingQueue = () => {
  const enqueued: MediaAssetId[] = []
  const queue: MediaQueue = { enqueue: (id) => Promise.resolve(void enqueued.push(id)) }
  return { enqueued, queue }
}

/** 入れる人の機械と、入れる口。 */
const userSide = (bundle: DemoBundleSource, overrides: Partial<DemoInstallerDeps> = {}) => {
  const world = aWorld()
  const queue = recordingQueue()
  const deps: DemoInstallerDeps = {
    bundle,
    projects: world.writers.projects,
    mediaAssets: world.mediaAssets,
    mediaIngest: { queue: queue.queue, logger: createLogger('silent') },
    storage: world.storage,
    writers: world.writers,
    logger: createLogger('silent'),
    ...overrides,
  }
  return { world, queue, deps, installer: createDemoInstaller(deps) }
}

const DEMO_KEY = 'ixa-demo-v1' as ProjectDemoKey

describe('目録が無いとき', () => {
  it('入れられないと答え、入れようとしても何も作らない', async () => {
    const empty = await makeTempDir()
    const { installer, world } = userSide(createDirBundleSource(empty))
    await expect(installer.status(world.workspaceId)).resolves.toEqual({ available: false, title: null, totalBytes: null, project: null })
    await expect(installer.install(world.workspaceId)).rejects.toBeInstanceOf(DemoUnavailableError)
    await removeDir(empty)
  })
})

describe('見本を入れる', () => {
  it('Shot・採用した Take・曲と解析（波形も）・テロップ・キャラクターの Look がそろった作品が、頼んだ作業場所にできる', async () => {
    const { installer, world, queue } = userSide(createDirBundleSource(bundleDir))
    const status = await installer.status(world.workspaceId)
    expect(status).toMatchObject({ available: true, title: '見本の作品', project: null })
    expect(status.totalBytes).toBe([...manifest.media, ...manifest.files].reduce((sum, e) => sum + e.sizeBytes, 0))

    const { project, created } = await installer.install(world.workspaceId)
    expect(created).toBe(true)
    expect(project).toMatchObject({ workspaceId: world.workspaceId, name: '見本の作品', demoKey: DEMO_KEY })
    const w = world.writers

    const shots = (await w.shots.findByProject(project.id)).sort((a, b) => a.order - b.order)
    expect(shots.map((shot) => shot.code)).toEqual(['CUT-01', 'CUT-02'])
    for (const shot of shots) {
      const selected = (await w.takes.findByShot(shot.id)).find((take) => take.id === shot.selectedTakeId)
      expect(selected).toBeDefined()
      // 採用した Take はこの機械の素材を指す（同じ中身）。
      const asset = await world.mediaAssets.findById(selected!.mediaAssetId)
      expect(asset?.workspaceId).toBe(world.workspaceId)
    }
    expect((await w.takes.findByShot(shots[0]!.id, { includeHidden: true })).length).toBe(2)

    const [track] = await w.musicTracks.findByProject(project.id)
    const analysis = await w.musicAnalyses.findByTrack(track!.id)
    expect(analysis?.bpm).toBe(120)
    // 波形は入れた作品・曲の ID から決まる置き場に置く（目録の置き場は目録の中の名前だけ）。
    expect(analysis?.waveformPeaksKey).toBe(waveformKey(project.id, track!.id))
    expect(analysis?.waveformPeaksKey).not.toBe(manifest.files[0]?.key)
    expect(await world.storage.exists(analysis!.waveformPeaksKey)).toBe(true)
    expect(await world.storage.exists(manifest.files[0]!.key)).toBe(false)

    const clips = await w.timelineClips.findByProject(project.id)
    expect(clips).toHaveLength(1)
    const [title] = clips
    expect(title?.content.type === 'text' ? title.content.params.text : null).toBe('見本の題名')

    const [character] = await w.characters.findByProject(project.id)
    const [look] = await w.looks.findByCharacter(character!.id)
    expect(look?.key).toBe('BASE')
    expect(await w.looks.listLookImages(look!.id)).toHaveLength(1)
    expect(await w.characters.listIdentityImages(character!.id)).toHaveLength(1)
    const [cast] = await w.shotCharacters.findByShot(shots[0]!.id)
    expect(cast?.lookId).toBe(look?.id)

    // 素材はアップロードと同じ道で登録し、取り込みジョブを投げる（サムネイルができる）。
    expect(queue.enqueued).toHaveLength(manifest.media.length)
    // 見本の素材はどの作品にも結び付けない（MCP の「この作品の素材か」の点検は、作品に属さない素材を通す）。
    for (const id of queue.enqueued) expect((await world.mediaAssets.findById(id))?.projectId).toBeNull()
    expect(project.styleReferenceAssetIds).toHaveLength(1)
    expect(project.styleReferenceAssetIds[0]).not.toBe(seeded.media.image1)
    expect((await world.mediaAssets.findById(project.styleReferenceAssetIds[0]!))?.checksumSha256).toBe(
      manifest.media.find((entry) => entry.id === seeded.media.image1)?.sha256,
    )
  })

  it('作る人の作業場所（A）で書き出した見本を B に入れても、A の ID を持つ行は 1 つも無い', async () => {
    // 目録には作業場所の ID が残る（作品・キャラクター・ロケーション・ブランド資産の形が必須）。入れる側は使わない。
    expect(JSON.stringify(manifest.source)).toContain(creator.workspaceId)
    const { installer, world } = userSide(createDirBundleSource(bundleDir))
    const { project } = await installer.install(world.workspaceId)
    const w = world.writers
    const characters = await w.characters.findByProject(project.id)
    const shots = await w.shots.findByProject(project.id)
    const rows = {
      project: await w.projects.findById(project.id),
      characters,
      looks: await Promise.all(characters.map((c) => w.looks.findByCharacter(c.id))),
      locations: await w.locations.findByProject(project.id),
      brandAssets: await w.brandAssets.findByProject(project.id),
      media: await world.mediaAssets.findByWorkspace(world.workspaceId),
      tracks: await w.musicTracks.findByProject(project.id),
      shots,
      takes: await Promise.all(shots.map((shot) => w.takes.findByShot(shot.id, { includeHidden: true }))),
      clips: await w.timelineClips.findByProject(project.id),
      voices: await w.voices.findByProject(project.id),
      lines: await w.narrationLines.findByProject(project.id),
    }
    expect(rows.media.length).toBe(manifest.media.length)
    expect(characters.every((c) => c.workspaceId === world.workspaceId)).toBe(true)
    expect(JSON.stringify(rows)).not.toContain(creator.workspaceId)
  })

  it('2 度目は同じ作品を返し、何も取りに行かない', async () => {
    const bundle = counting(createDirBundleSource(bundleDir))
    const { installer, world } = userSide(bundle.source)
    const first = await installer.install(world.workspaceId)
    const fetchedFirst = bundle.fetched.length
    expect(fetchedFirst).toBe(manifest.media.length + manifest.files.length)

    const second = await installer.install(world.workspaceId)
    expect(second).toEqual({ project: first.project, created: false })
    expect(bundle.fetched.length).toBe(fetchedFirst)
    expect((await installer.status(world.workspaceId)).project?.id).toBe(first.project.id)
  })

  it('同じ中身の素材が先にあれば、それを使って取りに行かない', async () => {
    const bundle = counting(createDirBundleSource(bundleDir))
    const { installer, world } = userSide(bundle.source)
    const reused = manifest.media.find((entry) => entry.id === seeded.media.video2)!
    const bytes = await readFile(join(bundleDir, reused.file))
    const storageKey = `media/${world.workspaceId}/x/original.mp4`
    await world.storage.put(storageKey, bytes, { contentType: 'video/mp4' })
    const existing = await world.mediaAssets.create({
      workspaceId: world.workspaceId,
      projectId: null,
      kind: 'video',
      storageKey,
      mimeType: 'video/mp4',
      bytes: bytes.byteLength,
      checksumSha256: sha256Of(bytes),
      origin: { type: 'upload', uploadedBy: 'test' },
      tags: [],
    })

    const { project } = await installer.install(world.workspaceId)
    expect(bundle.fetched).not.toContain(reused.file)
    const shotA = (await world.writers.shots.findByProject(project.id)).find((shot) => shot.code === 'CUT-01')!
    const selected = (await world.writers.takes.findByShot(shotA.id)).find((take) => take.id === shotA.selectedTakeId)
    expect(selected?.mediaAssetId).toBe(existing.id)
  })

  it('同時に 2 回頼まれても、作品は 1 つ', async () => {
    const { installer, world } = userSide(createDirBundleSource(bundleDir))
    const [a, b] = await Promise.all([installer.install(world.workspaceId), installer.install(world.workspaceId)])
    expect(a.project.id).toBe(b.project.id)
    expect((await world.writers.projects.findByWorkspace(world.workspaceId)).filter((p) => p.demoKey === DEMO_KEY)).toHaveLength(1)
  })

  it('別の入れる口が先に入れていたら（最後に印を付けるときに一意索引がぶつけたら）、自分の作品を消してそちらを返す', async () => {
    const { world, deps, installer } = userSide(createDirBundleSource(bundleDir))
    const first = await installer.install(world.workspaceId)
    // 2 つ目の入れる口（入れている途中の表を共有しない）。始めに読んだときはまだ無かった。
    const realProjects = world.writers.projects
    let reads = 0
    const raced = createDemoInstaller({
      ...deps,
      projects: {
        ...realProjects,
        findByDemoKey: (workspaceId, key) => {
          reads += 1
          return reads === 1 ? Promise.resolve(null) : realProjects.findByDemoKey(workspaceId, key)
        },
      },
    })
    await expect(raced.install(world.workspaceId)).resolves.toEqual({ project: first.project, created: false })
    expect(await realProjects.findByWorkspace(world.workspaceId)).toEqual([first.project])
  })
})

describe('書きかけの見本を「入っている」と読ませない', () => {
  /** 書き手の口の 1 つを、1 回だけ失敗させる。 */
  const failingOnce = <T extends object, K extends keyof T>(repo: T, key: K): T => {
    let failed = false
    const real = repo[key]
    return {
      ...repo,
      [key]: (...args: unknown[]) => {
        if (!failed) {
          failed = true
          return Promise.reject(new Error('書けませんでした'))
        }
        return typeof real === 'function' ? (real as (...a: unknown[]) => unknown).apply(repo, args) : real
      },
    }
  }

  it('作った直後の直し（update）が落ちても、印の付いた作品は残らず、次は最初から入れられる', async () => {
    const { world, deps } = userSide(createDirBundleSource(bundleDir))
    const installer = createDemoInstaller({ ...deps, writers: { ...world.writers, projects: failingOnce(world.writers.projects, 'update') } })
    await expect(installer.install(world.workspaceId)).rejects.toThrow()
    expect(await world.writers.projects.findByDemoKey(world.workspaceId, DEMO_KEY)).toBeNull()
    expect(await world.writers.projects.findByWorkspace(world.workspaceId)).toEqual([])
    expect((await installer.install(world.workspaceId)).created).toBe(true)
  })

  it('作りかけを消すのも落ちたら、作品は残るが印は付かず、次は入れ直す', async () => {
    const { world, deps } = userSide(createDirBundleSource(bundleDir))
    const installer = createDemoInstaller({
      ...deps,
      writers: {
        ...world.writers,
        projects: failingOnce(world.writers.projects, 'softDelete'),
        shots: failingOnce(world.writers.shots, 'createMany'),
      },
    })
    await expect(installer.install(world.workspaceId)).rejects.toThrow()
    expect(await world.writers.projects.findByDemoKey(world.workspaceId, DEMO_KEY)).toBeNull()
    expect((await world.writers.projects.findByWorkspace(world.workspaceId)).every((p) => p.demoKey === null)).toBe(true)
    const again = await installer.install(world.workspaceId)
    expect(again.created).toBe(true)
    expect(again.project.demoKey).toBe(DEMO_KEY)
  })

  it('書いている途中に状態を読んでも、入っている作品は無い', async () => {
    const { world, deps } = userSide(createDirBundleSource(bundleDir))
    let release: () => void = () => undefined
    let entered: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const inside = new Promise<void>((resolve) => (entered = resolve))
    const createMany = world.writers.shots.createMany.bind(world.writers.shots)
    const installer = createDemoInstaller({
      ...deps,
      writers: {
        ...world.writers,
        shots: {
          ...world.writers.shots,
          createMany: async (inputs) => {
            entered()
            await gate
            return createMany(inputs)
          },
        },
      },
    })
    const running = installer.install(world.workspaceId)
    await inside
    expect((await installer.status(world.workspaceId)).project).toBeNull()
    release()
    expect((await running).created).toBe(true)
    expect((await installer.status(world.workspaceId)).project?.id).toBe((await running).project.id)
  })
})

describe('壊れたもの・途中の失敗', () => {
  it('sha256 が合わなければ何も置かず、作品も作らない（理由はファイル名だけ）', async () => {
    const broken = await makeTempDir()
    // 最後に取るファイルを壊す（先に取ったものも置かれていないことを見る）。
    const bad = manifest.media.at(-1)!
    await writeFile(join(broken, 'manifest.json'), JSON.stringify(manifest))
    for (const entry of [...manifest.media, ...manifest.files]) {
      const bytes = await readFile(join(bundleDir, entry.file))
      await writeFile(join(broken, entry.file), entry.file === bad.file ? Buffer.alloc(bytes.byteLength, 1) : bytes)
    }
    const { installer, world } = userSide(createDirBundleSource(broken))

    const error: unknown = await installer.install(world.workspaceId).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DemoFileError)
    expect((error as DemoFileError).reason).toBe('broken')
    expect(demoFailureMessage(error)).toBe('見本のファイルが途中で壊れていました。もう一度試してください。')
    expect(await world.writers.projects.findByDemoKey(world.workspaceId, DEMO_KEY)).toBeNull()
    for (const entry of manifest.media) expect(await world.mediaAssets.findByChecksum(entry.sha256)).toBeNull()
    for (const entry of manifest.files) expect(await world.storage.exists(entry.key)).toBe(false)
    await removeDir(broken)
  })

  it('書く途中で失敗したら作りかけの作品を消し、次は入れられる', async () => {
    const { world, deps } = userSide(createDirBundleSource(bundleDir))
    let failOnce = true
    const createMany = world.writers.shots.createMany.bind(world.writers.shots)
    const flaky = createDemoInstaller({
      ...deps,
      writers: {
        ...world.writers,
        shots: {
          ...world.writers.shots,
          createMany: (inputs) => {
            if (failOnce) {
              failOnce = false
              return Promise.reject(new Error('書けませんでした'))
            }
            return createMany(inputs)
          },
        },
      },
    })
    await expect(flaky.install(world.workspaceId)).rejects.toThrow('見本を入れられませんでした')
    expect(await world.writers.projects.findByWorkspace(world.workspaceId)).toEqual([])

    const retried = await flaky.install(world.workspaceId)
    expect(retried.created).toBe(true)
    expect(await world.writers.shots.findByProject(retried.project.id)).toHaveLength(2)
  })

  it('目録の形が合わなければ（`..` を含むファイル名など）、見本は読めないと答える', async () => {
    const bad = await makeTempDir()
    await writeFile(join(bad, 'manifest.json'), JSON.stringify({ ...manifest, media: [{ ...manifest.media[0], file: '../x.mp4' }] }))
    const { installer, world } = userSide(createDirBundleSource(bad))
    await expect(installer.status(world.workspaceId)).rejects.toBeInstanceOf(DemoManifestError)
    await removeDir(bad)
  })
})

/** 作った見本のフォルダを写し、目録だけ差し替える（ファイルはそのまま）。 */
const bundleWith = async (edit: (m: DemoManifest) => unknown): Promise<string> => {
  const dir = await makeTempDir()
  for (const entry of [...manifest.media, ...manifest.files]) await writeFile(join(dir, entry.file), await readFile(join(bundleDir, entry.file)))
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(edit(structuredClone(manifest))))
  return dir
}

const reasonOf = async (promise: Promise<unknown>) => demoFailureReason(await promise.catch((e: unknown) => e))

describe('入れる前に断るもの', () => {
  it('作業場所が無ければ、何も取りに行かずに断る', async () => {
    const bundle = counting(createDirBundleSource(bundleDir))
    const { world, deps } = userSide(bundle.source)
    const installer = createDemoInstaller({ ...deps, projects: { ...world.writers.projects, workspaceExists: () => Promise.resolve(false) } })
    await expect(installer.install(world.workspaceId)).rejects.toBeInstanceOf(DemoWorkspaceMissingError)
    expect(bundle.fetched).toEqual([])
  })

  it('同じ sha256 の素材があっても、置き場の中身が違えば使わず、上書きもせずに断る', async () => {
    const bundle = counting(createDirBundleSource(bundleDir))
    const { installer, world } = userSide(bundle.source)
    const target = manifest.media.find((entry) => entry.id === seeded.media.video2)!
    const storageKey = `media/${world.workspaceId}/y/original.mp4`
    const wrong = new Uint8Array(target.sizeBytes).fill(7)
    await world.storage.put(storageKey, wrong, { contentType: 'video/mp4' })
    // 申告だけの checksum（アップロードの完了はクライアントの申告を確かめない）。
    await world.mediaAssets.create({
      workspaceId: world.workspaceId, projectId: null, kind: 'video', storageKey, mimeType: 'video/mp4',
      bytes: target.sizeBytes, checksumSha256: target.sha256, origin: { type: 'upload', uploadedBy: 'test' }, tags: [],
    })
    const error: unknown = await installer.install(world.workspaceId).catch((e: unknown) => e)
    expect(demoFailureReason(error)).toBe('conflict')
    expect(demoFailureMessage(error)).toBe('この機械にある素材の 1 つが、見本のファイルと中身が食い違っています。見本は入れませんでした。')
    expect(await world.storage.get(storageKey)).toEqual(wrong)
    expect(await world.writers.projects.findByWorkspace(world.workspaceId)).toEqual([])
  })

  it('素材の行を作れなければ（一意索引以外の失敗でも）、置いたファイルを消す', async () => {
    const { world, deps } = userSide(createDirBundleSource(bundleDir))
    const put: string[] = []
    const storage = { ...world.storage, put: (key: string, body: Uint8Array, options: { contentType: string }) => (put.push(key), world.storage.put(key, body, options)) }
    const installer = createDemoInstaller({
      ...deps,
      storage,
      mediaAssets: { ...world.mediaAssets, create: () => Promise.reject(new Error('DB が落ちています')) },
    })
    await expect(installer.install(world.workspaceId)).rejects.toThrow()
    const mediaKeys = put.filter((key) => key.startsWith('media/'))
    expect(mediaKeys.length).toBeGreaterThan(0)
    for (const key of mediaKeys) expect(await world.storage.exists(key)).toBe(false)
  })

  it('置いたファイルを消すのも失敗したら、元の失敗を投げ、消せなかったことはログに残す', async () => {
    const { world, deps } = userSide(createDirBundleSource(bundleDir))
    const logged: string[] = []
    const logger = createLogger('silent')
    const spy = { ...logger, error: (_obj: unknown, msg?: string) => void logged.push(String(msg)) } as unknown as typeof logger
    const installer = createDemoInstaller({
      ...deps,
      logger: spy,
      storage: { ...world.storage, delete: () => Promise.reject(new Error('消せません')) },
      mediaAssets: { ...world.mediaAssets, create: () => Promise.reject(new Error('DB が落ちています')) },
    })
    const error: unknown = await installer.install(world.workspaceId).catch((e: unknown) => e)
    expect((error as Error).message).toBe('DB が落ちています')
    expect(logged).toContain('見本の素材の行を作れず、置いたファイルも消せませんでした')
  })

  it('同じ置き場に中身の違うファイルが既にあれば、上書きせずに断る（入れた作品の置き場でも）', async () => {
    const { world, deps } = userSide(createDirBundleSource(bundleDir))
    const other = new TextEncoder().encode('{"peaks":[9]}')
    const installer = createDemoInstaller({
      ...deps,
      storage: {
        ...world.storage,
        exists: (key: string) => (key.endsWith('/peaks.json') ? Promise.resolve(true) : world.storage.exists(key)),
        get: (key: string) => (key.endsWith('/peaks.json') ? Promise.resolve(other) : world.storage.get(key)),
      },
    })
    expect(await reasonOf(installer.install(world.workspaceId))).toBe('conflict')
    expect(await world.writers.projects.findByDemoKey(world.workspaceId, DEMO_KEY)).toBeNull()
  })

  it('作る人の機械に入れても、元の作品の波形は使わず、自分の置き場に置く', async () => {
    const installer = createDemoInstaller({
      bundle: createDirBundleSource(bundleDir),
      projects: creator.writers.projects,
      mediaAssets: creator.mediaAssets,
      storage: creator.storage,
      writers: creator.writers,
      logger: createLogger('silent'),
    })
    const before = await creator.storage.get(seeded.peaksKey)
    const { project } = await installer.install(creator.workspaceId)
    const [track] = await creator.writers.musicTracks.findByProject(project.id)
    const analysis = await creator.writers.musicAnalyses.findByTrack(track!.id)
    expect(analysis?.waveformPeaksKey).toBe(waveformKey(project.id, track!.id))
    expect(analysis?.waveformPeaksKey).not.toBe(seeded.peaksKey)
    expect(await creator.storage.get(seeded.peaksKey)).toEqual(before)
  })

  it('目録に無い ULID を素材の欄に置いた目録は断る（この機械の素材に当たらせない）', async () => {
    const { world, deps } = userSide(createDirBundleSource(bundleDir))
    // 入れる人の機械にある素材の ID を、目録の Take に書き込む。
    const local = await world.mediaAssets.create({
      workspaceId: world.workspaceId, projectId: null, kind: 'image', storageKey: `media/${world.workspaceId}/z/original.png`,
      mimeType: 'image/png', bytes: 1, checksumSha256: 'e'.repeat(64), origin: { type: 'upload', uploadedBy: 'test' }, tags: [],
    })
    const dir = await bundleWith((m) => {
      const shots = m.source['shots'] as { takes: { mediaAssetId: string }[] }[]
      shots[0]!.takes[0]!.mediaAssetId = local.id
      return m
    })
    const installer = createDemoInstaller({ ...deps, bundle: createDirBundleSource(dir) })
    expect(await reasonOf(installer.install(world.workspaceId))).toBe('invalid')
    expect(await world.writers.projects.findByWorkspace(world.workspaceId)).toEqual([])
    await removeDir(dir)
  })

  it('目録の中で定めた ID が、この機械の素材の ID と同じなら断る（結び付きは閉じたまま）', async () => {
    const victim = aWorld()
    const local = await victim.mediaAssets.create({
      workspaceId: victim.workspaceId, projectId: null, kind: 'image', storageKey: `media/${victim.workspaceId}/z/original.png`,
      mimeType: 'image/png', bytes: 1, checksumSha256: 'e'.repeat(64), origin: { type: 'upload', uploadedBy: 'test' }, tags: [],
    })
    // ロケーションの ID を、それを指すすべての所ごと、この機械の素材の ID に替える（目録の中の結び付きは閉じている）。
    const dir = await bundleWith((m) => {
      const locationId = (m.source['locations'] as { id: string }[])[0]!.id
      const source = remapExactValues(m.source, new Map([[locationId, local.id]])) as Record<string, unknown>
      expect(demoBindingProblems({ ...m, source })).toEqual([])
      return { ...m, source }
    })
    const installer = createDemoInstaller({
      bundle: createDirBundleSource(dir),
      projects: victim.writers.projects,
      mediaAssets: victim.mediaAssets,
      storage: victim.storage,
      writers: victim.writers,
      logger: createLogger('silent'),
    })
    const error: unknown = await installer.install(victim.workspaceId).catch((e: unknown) => e)
    expect(demoFailureReason(error)).toBe('invalid')
    expect((error as Error).message).toContain('この機械の素材と 1 件重なっています')
    expect(await victim.writers.projects.findByWorkspace(victim.workspaceId)).toEqual([])
    await removeDir(dir)
  })

  it('目録で定めた ID が、この機械の消した素材の ID と同じでも、入れた作品のどの行もその素材を指さない', async () => {
    const victim = aWorld()
    const deleted = await victim.mediaAssets.create({
      workspaceId: victim.workspaceId, projectId: null, kind: 'image', storageKey: `media/${victim.workspaceId}/d/original.png`,
      mimeType: 'image/png', bytes: 1, checksumSha256: 'f'.repeat(64), origin: { type: 'upload', uploadedBy: 'test' }, tags: [],
    })
    await victim.mediaAssets.softDelete(deleted.id)
    // ロケーションの ID を消した素材の ID にし、Take の素材の欄もその ID で指す（定めた ID なので結び付きは閉じている）。
    const dir = await bundleWith((m) => {
      const locationId = (m.source['locations'] as { id: string }[])[0]!.id
      const source = remapExactValues(m.source, new Map([[locationId, deleted.id]])) as Record<string, unknown>
      const shots = source['shots'] as { takes: { mediaAssetId: string }[] }[]
      shots[0]!.takes[0]!.mediaAssetId = deleted.id
      expect(demoBindingProblems({ ...m, source })).toEqual([])
      return { ...m, source }
    })
    const installer = createDemoInstaller({
      bundle: createDirBundleSource(dir),
      projects: victim.writers.projects,
      mediaAssets: victim.mediaAssets,
      storage: victim.storage,
      writers: victim.writers,
      logger: createLogger('silent'),
    })
    // 入れられても入れられなくても、生きている作品の行が消した素材を指してはいけない（定めた ID は新しい ID に付け替える）。
    await installer.install(victim.workspaceId).catch(() => undefined)
    const projects = await victim.writers.projects.findByWorkspace(victim.workspaceId)
    const rows = await Promise.all(
      projects.map(async (p) => {
        const shots = await victim.writers.shots.findByProject(p.id)
        return {
          shots,
          takes: await Promise.all(shots.map((shot) => victim.writers.takes.findByShot(shot.id, { includeHidden: true }))),
          locations: await victim.writers.locations.findByProject(p.id),
          clips: await victim.writers.timelineClips.findByProject(p.id),
        }
      }),
    )
    expect(JSON.stringify(rows)).not.toContain(deleted.id)
    await removeDir(dir)
  })

  it('使われない枝の `id` は ID を定めない（読んだ後の中身で数える）', async () => {
    const { world, deps } = userSide(createDirBundleSource(bundleDir))
    const stray = newId(MediaAssetIdSchema)
    const dir = await bundleWith((m) => {
      const shots = m.source['shots'] as { takes: { mediaAssetId: string }[] }[]
      shots[0]!.takes[0]!.mediaAssetId = stray
      // 形に無い枝（読むと落ちる）で、その ID を「定めた」ことにしようとする。
      return { ...m, source: { ...m.source, unused: { id: stray } } }
    })
    const installer = createDemoInstaller({ ...deps, bundle: createDirBundleSource(dir) })
    expect(await reasonOf(installer.install(world.workspaceId))).toBe('invalid')
    await removeDir(dir)
  })

  it('曲の解析の波形の置き場が目録の files に無ければ断る', async () => {
    const dir = await bundleWith((m) => {
      const tracks = m.source['tracks'] as { analyses: { waveformPeaksKey: string }[] }[]
      tracks[0]!.analyses[0]!.waveformPeaksKey = 'music/other/track/peaks.json'
      return m
    })
    const { installer, world } = userSide(createDirBundleSource(dir))
    expect(await reasonOf(installer.install(world.workspaceId))).toBe('invalid')
    await removeDir(dir)
  })

  it('声とナレーションの口が繋がっていないのに目録に声があれば、黙って落とさずに断る', async () => {
    const { world, deps } = userSide(createDirBundleSource(bundleDir))
    const { voices: _v, narrationLines: _l, narrationTakes: _t, ...withoutNarration } = world.writers
    void _v
    void _l
    void _t
    const installer = createDemoInstaller({ ...deps, writers: withoutNarration })
    await expect(installer.install(world.workspaceId)).rejects.toThrow('声とナレーション')
    expect(await world.writers.projects.findByWorkspace(world.workspaceId)).toEqual([])
  })
})
