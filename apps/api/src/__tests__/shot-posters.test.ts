import {
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  TakeId as TakeIdSchema,
  newId,
  type MediaAsset,
  type Project,
  type Shot,
  type Take,
} from '@ixa/domain'
import { replaceManualStartFrame } from '@ixa/generation'
import {
  aShot,
  aTake,
  createInMemoryImageJobRepository,
  createInMemoryMediaAssetRepository,
  createInMemoryShotReferenceRepository,
  type InMemoryImageJobRepository,
  type InMemoryShotReferenceRepository,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
  type InMemoryMediaAssetRepository,
} from '@ixa/generation/testing'
import { createMemoryStorage } from '@ixa/storage'
import type { ObjectStorage } from '@ixa/storage'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SIGNED_URL_EXPIRES_SEC } from '../routes/media.js'
import {
  SHOT_POSTER_REASON,
  ShotPosterResponse,
  shotPosterRoutes,
  type ShotPosterRoutesDeps,
} from '../routes/shot-posters.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

type ListBody = { success: true; data: ShotPosterResponse[]; meta: { total: number } }
type ErrorBody = { success: false; error: string }

/** サムネイルの有無を選べる MediaAsset を 1 件積む。 */
const seedAsset = async (
  repo: InMemoryMediaAssetRepository,
  project: Project,
  options: { thumbnailKey: string | null; checksum: string },
): Promise<MediaAsset> =>
  repo.create({
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'video',
    storageKey: `media/${project.workspaceId}/${options.checksum}/original.mp4`,
    mimeType: 'video/mp4',
    bytes: 1024,
    checksumSha256: options.checksum,
    thumbnailKey: options.thumbnailKey,
    origin: { type: 'upload', uploadedBy: 'editor' },
    tags: [],
  })

type Fixture = {
  readonly project: Project
  readonly shots: readonly Shot[]
  readonly takes: readonly Take[]
  readonly mediaAssets: InMemoryMediaAssetRepository
  readonly storage: ObjectStorage
  readonly shotReferences?: InMemoryShotReferenceRepository
  readonly imageJobs?: InMemoryImageJobRepository
}

const buildApp = (fixture: Fixture) => {
  const deps: ShotPosterRoutesDeps = {
    projects: createInMemoryProjectRepository([fixture.project]),
    shots: createInMemoryShotRepository(fixture.shots),
    takes: createInMemoryTakeRepository(fixture.takes),
    mediaAssets: fixture.mediaAssets,
    storage: fixture.storage,
    shotReferences: fixture.shotReferences ?? createInMemoryShotReferenceRepository(),
    imageJobs: fixture.imageJobs ?? createInMemoryImageJobRepository(),
  }
  return shotPosterRoutes(deps)
}

/**
 * 3 通りが 1 応答に混ざる土台を作る。
 * shot1: Take 未選択 / shot2: 採用 Take はあるが派生物がまだ / shot3: 正常。
 */
const mixedFixture = async (): Promise<Fixture & { readonly thumbnailKey: string }> => {
  const project = aProject()
  const storage = createMemoryStorage()
  const mediaAssets = createInMemoryMediaAssetRepository()

  const thumbnailKey = `media/${project.workspaceId}/thumb/poster.jpg`
  const withThumb = await seedAsset(mediaAssets, project, {
    thumbnailKey,
    checksum: 'a'.repeat(64),
  })
  const withoutThumb = await seedAsset(mediaAssets, project, {
    thumbnailKey: null,
    checksum: 'b'.repeat(64),
  })

  const shot1 = aShot(project.id, { order: 1000, code: 'shot_001' })

  const pendingShot = aShot(project.id, { order: 2000, code: 'shot_002' })
  const pendingTake = aTake(pendingShot, '1'.repeat(64), { mediaAssetId: withoutThumb.id })
  const shot2 = { ...pendingShot, selectedTakeId: pendingTake.id }

  const readyShot = aShot(project.id, { order: 3000, code: 'shot_003' })
  const readyTake = aTake(readyShot, '2'.repeat(64), { mediaAssetId: withThumb.id })
  const shot3 = { ...readyShot, selectedTakeId: readyTake.id }

  return {
    project,
    shots: [shot1, shot2, shot3],
    takes: [pendingTake, readyTake],
    mediaAssets,
    storage,
    thumbnailKey,
  }
}

/**
 * 採用 Take が無いときの文を、Shot の状態で言い分ける。
 *
 * 以前は一律「Take が選ばれていません」で、生成直後のカードにも生成前のカードにも同じ文が出た。
 * 生成が終わって「採用待ち」の Shot では、次の一手（採用する）が読めなかった。
 */
describe('採用 Take が無いときの文', () => {
  const reasonFor = async (status: 'draft' | 'generating' | 'review' | 'blocked') => {
    const project = aProject()
    const shot = aShot(project.id, { order: 1000, code: 'shot_001', status })
    const res = await buildApp({
      project,
      shots: [shot],
      takes: [],
      mediaAssets: createInMemoryMediaAssetRepository(),
      storage: createMemoryStorage(),
    }).request(`/projects/${project.id}/shot-posters`)
    const json = (await res.json()) as ListBody
    return json.data[0]?.reason
  }

  it('採用待ち（Take はある）なら、採用すれば出ると言う', async () => {
    expect(await reasonFor('review')).toBe(SHOT_POSTER_REASON.notAdopted)
  })

  it('生成中なら、生成中と言う', async () => {
    expect(await reasonFor('generating')).toBe(SHOT_POSTER_REASON.generating)
  })

  it('まだ Take が無ければ、そう言う', async () => {
    expect(await reasonFor('draft')).toBe(SHOT_POSTER_REASON.noTake)
    expect(await reasonFor('blocked')).toBe(SHOT_POSTER_REASON.noTake)
  })

  it('3 つの文はすべて違う（同じ文だと言い分けた意味が無い）', () => {
    const texts = [SHOT_POSTER_REASON.notAdopted, SHOT_POSTER_REASON.generating, SHOT_POSTER_REASON.noTake]
    expect(new Set(texts).size).toBe(3)
  })
})

describe('GET /projects/:projectId/shot-posters', () => {
  it('Take なし / 派生物なし / 正常 が 1 応答に混ざり、順序は Shot の order に従う', async () => {
    const fixture = await mixedFixture()

    const res = await buildApp(fixture).request(`/projects/${fixture.project.id}/shot-posters`)

    expect(res.status).toBe(200)

    const json = (await res.json()) as ListBody
    expect(json.meta.total).toBe(3)

    const [noTake, notReady, ready] = json.data
    expect(noTake?.takeId).toBeNull()
    expect(noTake?.thumbnailUrl).toBeNull()
    expect(noTake?.reason).toBe(SHOT_POSTER_REASON.noTake)

    expect(notReady?.takeId).not.toBeNull()
    expect(notReady?.thumbnailUrl).toBeNull()
    expect(notReady?.reason).toBe(SHOT_POSTER_REASON.thumbnailNotReady)

    expect(ready?.thumbnailUrl).toContain(fixture.thumbnailKey)
    expect(ready?.reason).toBeNull()
  })

  /**
   * 待てば出る行だけに印を付ける（2026-09-27）。画面はこの印がある間だけ取り直す。
   * 以前は生成が終わった瞬間に 1 回取るだけで、サムネイルがその後にできても出なかった
   * （読み直すまで「作られていません」のまま。デモの録画で実測）。
   */
  it('サムネイルを作っている行だけ pending が true', async () => {
    const fixture = await mixedFixture()

    const res = await buildApp(fixture).request(`/projects/${fixture.project.id}/shot-posters`)
    const [noTake, notReady, ready] = ((await res.json()) as ListBody).data

    expect((notReady as { pending?: boolean }).pending).toBe(true)
    expect((noTake as { pending?: boolean }).pending).toBe(false)
    expect((ready as { pending?: boolean }).pending).toBe(false)
  })

  it('画面に出る理由に実装の言葉（media / worker / API）を入れない', () => {
    for (const reason of Object.values(SHOT_POSTER_REASON)) {
      expect(reason).not.toMatch(/media|worker|API/i)
    }
  })

  it('URL が null の行には必ず理由が付く（空欄のまま見過ごさない / L-015）', async () => {
    const fixture = await mixedFixture()

    const res = await buildApp(fixture).request(`/projects/${fixture.project.id}/shot-posters`)
    const json = (await res.json()) as ListBody

    expect(json.data.length).toBeGreaterThan(0)
    for (const entry of json.data) {
      if (entry.thumbnailUrl === null) {
        expect(entry.reason).toEqual(expect.any(String))
        expect(entry.reason).not.toBe('')
      } else {
        expect(entry.reason).toBeNull()
      }
    }
  })

  it('応答の全行がスキーマを通る（URL と理由の対はスキーマでも固定する）', async () => {
    const fixture = await mixedFixture()

    const res = await buildApp(fixture).request(`/projects/${fixture.project.id}/shot-posters`)
    const json = (await res.json()) as ListBody

    for (const entry of json.data) {
      expect(ShotPosterResponse.safeParse(entry).success).toBe(true)
    }
  })

  it('スキーマは「理由の無い空枠」と「URL と理由の両立」を弾く（L-015）', () => {
    const base = {
      shotId: newId(ShotIdSchema),
      takeId: null,
      pending: false,
      hasStartFrame: false,
      drawing: false,
    }

    expect(
      ShotPosterResponse.safeParse({ ...base, thumbnailUrl: null, reason: null }).success,
    ).toBe(false)
    expect(
      ShotPosterResponse.safeParse({
        ...base,
        thumbnailUrl: 'memory://thumbs/one.jpg',
        reason: SHOT_POSTER_REASON.noTake,
      }).success,
    ).toBe(false)
    expect(
      ShotPosterResponse.safeParse({
        ...base,
        thumbnailUrl: null,
        reason: SHOT_POSTER_REASON.noTake,
      }).success,
    ).toBe(true)
  })

  it('理由は状態ごとに違う文言になる（まとめて 1 文にしない）', async () => {
    const fixture = await mixedFixture()

    const res = await buildApp(fixture).request(`/projects/${fixture.project.id}/shot-posters`)
    const json = (await res.json()) as ListBody

    const reasons = json.data.flatMap((entry) => (entry.reason === null ? [] : [entry.reason]))
    expect(new Set(reasons).size).toBe(reasons.length)
  })

  it('採用 Take の行が引けないときは「まだ」ではなく異常として書く', async () => {
    const project = aProject()
    const shot = {
      ...aShot(project.id),
      selectedTakeId: newId(TakeIdSchema),
    }

    const res = await buildApp({
      project,
      shots: [shot],
      takes: [],
      mediaAssets: createInMemoryMediaAssetRepository(),
      storage: createMemoryStorage(),
    }).request(`/projects/${project.id}/shot-posters`)

    const json = (await res.json()) as ListBody
    expect(json.data[0]?.takeId).toBe(shot.selectedTakeId)
    expect(json.data[0]?.reason).toBe(SHOT_POSTER_REASON.takeMissing)
  })

  it('MediaAsset が引けないときは「メディアが見つかりません」を返す', async () => {
    const project = aProject()
    const baseShot = aShot(project.id)
    const take = aTake(baseShot, '3'.repeat(64))
    const shot = { ...baseShot, selectedTakeId: take.id }

    const res = await buildApp({
      project,
      shots: [shot],
      takes: [take],
      mediaAssets: createInMemoryMediaAssetRepository(),
      storage: createMemoryStorage(),
    }).request(`/projects/${project.id}/shot-posters`)

    const json = (await res.json()) as ListBody
    expect(json.data[0]?.thumbnailUrl).toBeNull()
    expect(json.data[0]?.reason).toBe(SHOT_POSTER_REASON.mediaMissing)
  })

  it('署名の期限は media.ts の既定と一致する（書き写さない / L-016）', async () => {
    const fixture = await mixedFixture()

    const res = await buildApp(fixture).request(`/projects/${fixture.project.id}/shot-posters`)
    const json = (await res.json()) as ListBody

    const url = json.data.find((entry) => entry.thumbnailUrl !== null)?.thumbnailUrl
    expect(url).toContain(`expires=${String(DEFAULT_SIGNED_URL_EXPIRES_SEC)}`)
  })

  it('同じ Take / MediaAsset を共有する Shot でも、引く回数は 1 回で済む', async () => {
    const project = aProject()
    const storage = createMemoryStorage()
    const mediaAssets = createInMemoryMediaAssetRepository()
    const asset = await seedAsset(mediaAssets, project, {
      thumbnailKey: `media/${project.workspaceId}/shared/poster.jpg`,
      checksum: 'c'.repeat(64),
    })

    const baseShot = aShot(project.id)
    const take = aTake(baseShot, '4'.repeat(64), { mediaAssetId: asset.id })
    const shots = [
      { ...baseShot, selectedTakeId: take.id },
      { ...aShot(project.id, { order: 2000, code: 'shot_002' }), selectedTakeId: take.id },
    ]

    const takes = createInMemoryTakeRepository([take])
    let findByIdCalls = 0
    const countingTakes = {
      ...takes,
      findById: (id: Parameters<typeof takes.findById>[0]) => {
        findByIdCalls += 1
        return takes.findById(id)
      },
    }

    const app = shotPosterRoutes({
      projects: createInMemoryProjectRepository([project]),
      shots: createInMemoryShotRepository(shots),
      takes: countingTakes,
      mediaAssets,
      storage,
      shotReferences: createInMemoryShotReferenceRepository(),
      imageJobs: createInMemoryImageJobRepository(),
    })

    const json = (await (
      await app.request(`/projects/${project.id}/shot-posters`)
    ).json()) as ListBody

    expect(json.data).toHaveLength(2)
    expect(json.data.every((entry) => entry.thumbnailUrl !== null)).toBe(true)
    expect(findByIdCalls).toBe(1)
  })

  it('Shot が 0 件なら 200 と空配列', async () => {
    const project = aProject()

    const res = await buildApp({
      project,
      shots: [],
      takes: [],
      mediaAssets: createInMemoryMediaAssetRepository(),
      storage: createMemoryStorage(),
    }).request(`/projects/${project.id}/shot-posters`)

    expect(res.status).toBe(200)

    const json = (await res.json()) as ListBody
    expect(json.data).toEqual([])
    expect(json.meta.total).toBe(0)
  })

  it('存在しない Project は 404', async () => {
    const project = aProject()

    const res = await buildApp({
      project,
      shots: [],
      takes: [],
      mediaAssets: createInMemoryMediaAssetRepository(),
      storage: createMemoryStorage(),
    }).request(`/projects/${newId(ProjectIdSchema)}/shot-posters`)

    expect(res.status).toBe(404)

    const json = (await res.json()) as ErrorBody
    expect(json.success).toBe(false)
  })

  it('ULID でない projectId は 422', async () => {
    const project = aProject()

    const res = await buildApp({
      project,
      shots: [],
      takes: [],
      mediaAssets: createInMemoryMediaAssetRepository(),
      storage: createMemoryStorage(),
    }).request('/projects/not-a-ulid/shot-posters')

    expect(res.status).toBe(422)
  })

})

/**
 * **採用 Take が無い Shot は、最初のフレーム（絵コンテの画像）を絵に使う**（ADR-0029）。
 * 以前は採用 Take のサムネイルしか見ず、絵コンテの画像を作ってもストーリーボードに絵が出なかった。
 */
describe('最初のフレームを絵に使う', () => {
  const setup = async (options: {
    thumbnail: boolean
    adopted?: boolean
    drawing?: boolean
    /** 最初のフレームを付けない。 */
    noFrame?: boolean
  }) => {
    const project = aProject()
    const storage = createMemoryStorage()
    const mediaAssets = createInMemoryMediaAssetRepository()
    const shotReferences = createInMemoryShotReferenceRepository()
    const imageJobs = createInMemoryImageJobRepository()
    const frame = await mediaAssets.create({
      workspaceId: project.workspaceId,
      projectId: project.id,
      kind: 'image',
      storageKey: `media/${project.workspaceId}/frame/original.png`,
      mimeType: 'image/png',
      bytes: 10,
      checksumSha256: 'c'.repeat(64),
      thumbnailKey: options.thumbnail ? `media/${project.workspaceId}/frame/thumb.jpg` : null,
      origin: { type: 'upload', uploadedBy: 'editor' },
      tags: [],
    })
    const video = await seedAsset(mediaAssets, project, { thumbnailKey: `media/${project.workspaceId}/take/thumb.jpg`, checksum: 'd'.repeat(64) })
    const base = aShot(project.id, { order: 1000, code: 'shot_001' })
    const take = aTake(base, '3'.repeat(64), { mediaAssetId: video.id })
    const shot = options.adopted === true ? { ...base, selectedTakeId: take.id } : base
    if (options.noFrame !== true) await replaceManualStartFrame(shotReferences, shot.id, frame.id)
    if (options.drawing === true) {
      await imageJobs.create({
        kind: 'start_frame',
        projectId: project.id,
        shotId: shot.id,
        providerId: 'codex-cli' as never,
        modelId: 'codex-cli/image-gen' as never,
      })
    }
    const res = await buildApp({ project, shots: [shot], takes: [take], mediaAssets, storage, shotReferences, imageJobs }).request(
      `/projects/${project.id}/shot-posters`,
    )
    return ((await res.json()) as ListBody).data[0]
  }

  it('採用 Take が無ければ、最初のフレームのサムネイルを出す', async () => {
    const poster = await setup({ thumbnail: true })
    expect(poster?.thumbnailUrl).toContain('frame/thumb.jpg')
    expect(poster).toMatchObject({ takeId: null, reason: null, pending: false })
  })

  it('最初のフレームのサムネイルがまだなら、待てば出ると言う', async () => {
    expect(await setup({ thumbnail: false })).toMatchObject({
      thumbnailUrl: null,
      reason: SHOT_POSTER_REASON.thumbnailNotReady,
      pending: true,
    })
  })

  it('絵コンテの画像を作っている間は、そう言って待つ', async () => {
    expect(await setup({ thumbnail: true, drawing: true })).toMatchObject({
      thumbnailUrl: null,
      reason: SHOT_POSTER_REASON.drawing,
      pending: true,
    })
  })

  it('採用 Take があれば、そちらを出す（最初のフレームより優先）', async () => {
    const poster = await setup({ thumbnail: true, adopted: true })
    expect(poster?.thumbnailUrl).toContain('take/thumb.jpg')
  })

  /** 流れの帯（絵 n/39）と「説明も絵も無い」の確認に使う（制作者 2026-10-01）。 */
  it('最初のフレームがあるかを返す（採用 Take があっても・作っている間も）', async () => {
    expect((await setup({ thumbnail: true }))?.hasStartFrame).toBe(true)
    expect((await setup({ thumbnail: true, adopted: true }))?.hasStartFrame).toBe(true)
    expect((await setup({ thumbnail: true, drawing: true }))?.hasStartFrame).toBe(true)
    expect((await setup({ thumbnail: true, noFrame: true }))?.hasStartFrame).toBe(false)
    expect((await setup({ thumbnail: true, adopted: true, noFrame: true }))?.hasStartFrame).toBe(false)
  })

  /**
   * 絵を作っているかを、採用 Take があっても返す（制作者 2026-10-03「Shot 一覧もぐるぐる表示したほうがいいが、
   * 画像と動画で見た目は切り替えたほうがよさそう」）。以前は採用 Take があると、絵を作っていることが一覧に出なかった。
   */
  it('絵を作っているかを返す（採用 Take があっても）', async () => {
    expect((await setup({ thumbnail: true, drawing: true }))?.drawing).toBe(true)
    expect((await setup({ thumbnail: true, adopted: true, drawing: true }))?.drawing).toBe(true)
    expect((await setup({ thumbnail: true }))?.drawing).toBe(false)
  })
})
