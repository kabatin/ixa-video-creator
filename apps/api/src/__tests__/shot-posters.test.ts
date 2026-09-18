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
import {
  aShot,
  aTake,
  createInMemoryMediaAssetRepository,
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
    origin: { type: 'upload', uploadedBy: 'h.kabayama' },
    tags: [],
  })

type Fixture = {
  readonly project: Project
  readonly shots: readonly Shot[]
  readonly takes: readonly Take[]
  readonly mediaAssets: InMemoryMediaAssetRepository
  readonly storage: ObjectStorage
}

const buildApp = (fixture: Fixture) => {
  const deps: ShotPosterRoutesDeps = {
    projects: createInMemoryProjectRepository([fixture.project]),
    shots: createInMemoryShotRepository(fixture.shots),
    takes: createInMemoryTakeRepository(fixture.takes),
    mediaAssets: fixture.mediaAssets,
    storage: fixture.storage,
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
