import { ProjectId, WorkspaceId, newId } from '@ixa/domain'
import { createInMemoryBrandAssetRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { resolveBrandColorTargets } from '../review-wiring.js'

/**
 * ブランドの色の点検（Brand Review）は、そのプロジェクトのブランド資産だけを見る（ADR-0034。制作者 2026-10-03
 * 「全プロジェクトで共有になっている。プロジェクト単位にしないと大変なことになる」）。
 * 以前はワークスペースの色を全部見ていて、iXA の映像を LUNA BREW の色でも点検していた。
 */

describe('resolveBrandColorTargets', () => {
  it('そのプロジェクトの色だけを点検の対象にする', async () => {
    const workspaceId = newId(WorkspaceId)
    const ixa = newId(ProjectId)
    const luna = newId(ProjectId)
    const brandAssets = createInMemoryBrandAssetRepository()
    await brandAssets.create({ workspaceId, projectId: ixa, category: 'color', name: 'iXA Yellow', value: '#FFD200' })
    await brandAssets.create({ workspaceId, projectId: luna, category: 'color', name: 'LUNA アンバー', value: '#C8873A' })
    const projects = { findById: (id: typeof ixa) => Promise.resolve(id === ixa ? { id, workspaceId } : null) }

    const targets = await resolveBrandColorTargets(brandAssets, projects, ixa)

    expect(targets.map((target) => target.key)).toEqual(['iXA Yellow'])
  })
})
