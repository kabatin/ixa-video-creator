import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DemoManifest, MediaAssetId, ProjectDemoKey } from '@ixa/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDirBundleSource, type DemoBundleSource } from '../demo-project/bundle-source.js'
import { DemoFileError, DemoManifestError, DemoUnavailableError, demoFailureMessage } from '../demo-project/errors.js'
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
    expect(await world.storage.exists(analysis!.waveformPeaksKey)).toBe(true)

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
    const existing = await world.mediaAssets.create({
      workspaceId: world.workspaceId,
      projectId: null,
      kind: 'video',
      storageKey: `media/${world.workspaceId}/x/original.mp4`,
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

  it('別の入れる口が先に作っていたら（一意索引がぶつけたら）、そちらを返す', async () => {
    const { world, deps, installer } = userSide(createDirBundleSource(bundleDir))
    const first = await installer.install(world.workspaceId)
    // 2 つ目の入れる口（入れている途中の表を共有しない）。始めに読んだときはまだ無く、作るときに一意索引にぶつかる。
    const realProjects = world.writers.projects
    let reads = 0
    const raced = createDemoInstaller({
      ...deps,
      projects: {
        findByDemoKey: (workspaceId, key) => {
          reads += 1
          return reads === 1 ? Promise.resolve(null) : realProjects.findByDemoKey(workspaceId, key)
        },
      },
      writers: {
        ...world.writers,
        projects: {
          ...realProjects,
          create: () => Promise.reject(Object.assign(new Error('duplicate key value'), { code: '23505' })),
        },
      },
    })
    await expect(raced.install(world.workspaceId)).resolves.toEqual({ project: first.project, created: false })
    expect((await realProjects.findByWorkspace(world.workspaceId)).filter((p) => p.demoKey === DEMO_KEY)).toHaveLength(1)
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
