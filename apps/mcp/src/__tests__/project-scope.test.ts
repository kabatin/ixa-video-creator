import { describe, expect, it } from 'vitest'
import { resolveImage } from '../lib/image-source.js'
import { assertMediaInProject, assertShotsInProject, assertTakesOfShot } from '../lib/project-scope.js'
import { createFakeApi, depsFor, ownedMedia, ownedShots, takeRow, ulid, WORKSPACE } from './fake-api.js'

/** 作品の外の ID を、書く前に断る（lib/project-scope.ts）。 */

const P = ulid('PJ1')
const OTHER = ulid('PJ2')
const SHOT = ulid('SH1')
const clientOf = (fake: ReturnType<typeof createFakeApi>) => depsFor(fake).api

describe('project-scope', () => {
  it('作品に無い Shot は断る', async () => {
    const api = clientOf(createFakeApi([ownedShots(P, [SHOT])]))
    await expect(assertShotsInProject(api, P, [SHOT])).resolves.toHaveLength(1)
    await expect(assertShotsInProject(api, P, [ulid('SH9')])).rejects.toThrow('この作品に無い Shot です')
  })

  it('その Shot に無い Take は断る', async () => {
    const api = clientOf(
      createFakeApi([ownedShots(P, [SHOT]), { method: 'GET', path: `/shots/${SHOT}/takes`, data: [takeRow(ulid('TK1'), null, null, SHOT)] }]),
    )
    await expect(assertTakesOfShot(api, P, SHOT, [ulid('TK1')])).resolves.toHaveLength(1)
    await expect(assertTakesOfShot(api, P, SHOT, [ulid('TK9')])).rejects.toThrow('その Shot に無い Take です')
  })

  it('別の作品の素材は断り、作品に属さない素材は通す', async () => {
    await expect(assertMediaInProject(clientOf(createFakeApi([ownedMedia(OTHER)])), P, [ulid('MD1')])).rejects.toThrow('この作品に無い素材です')
    await expect(assertMediaInProject(clientOf(createFakeApi([ownedMedia(null)])), P, [ulid('MD1')])).resolves.toBeUndefined()
  })

  it('画像の出どころも、別の作品の素材・Shot なら断る', async () => {
    const context = { workspaceId: WORKSPACE, projectId: P }
    await expect(resolveImage(clientOf(createFakeApi([ownedMedia(OTHER)])), { mediaAssetId: ulid('MD1') }, context)).rejects.toThrow('この作品に無い素材です')
    await expect(resolveImage(clientOf(createFakeApi([ownedShots(P, [])])), { fromShotStartFrame: SHOT }, context)).rejects.toThrow('この作品に無い Shot です')
  })
})
