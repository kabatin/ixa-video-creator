import { describe, expect, it } from 'vitest'
import { importFromProjectTool, duplicateProjectTool } from '../tools/project-copy.js'
import { updateProjectTool } from '../tools/project.js'
import { editLocationTool, manageBrandAssetsTool } from '../tools/library-edit.js'
import { createFakeApi, depsFor, jsonOf, textOf, ulid, WORKSPACE, ownedMedia } from './fake-api.js'

const PROJECT = ulid('PJ1')
const OTHER = ulid('PJ2')
const ASSET = ulid('MD1')
const LOC = ulid('SPT1')
const BRAND = ulid('BR1')

const projectRow = (overrides: Record<string, unknown> = {}) => ({
  id: PROJECT,
  workspaceId: WORKSPACE,
  name: 'テスト',
  fps: 24,
  resolution: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  durationSec: null,
  status: 'planning',
  ...overrides,
})

describe('update_project', () => {
  it('渡した項目だけを PATCH し、手本画像は素材の ID に直し、コンセプトは脚本の版を積む', async () => {
    const fake = createFakeApi([
      { method: 'PATCH', path: `/projects/${PROJECT}`, data: projectRow({ styleGuide: '水彩', durationSec: 116 }) },
      ownedMedia(PROJECT),
      { method: 'POST', path: `/projects/${PROJECT}/script/versions`, status: 201, data: { version: { content: 'c' } } },
    ])
    const result = jsonOf(
      await updateProjectTool.run(
        { projectId: PROJECT, styleGuide: '水彩', durationSec: 116, styleReferences: [{ mediaAssetId: ASSET }], concept: '夏の歌' },
        depsFor(fake),
      ),
    ) as { project: { styleGuide: string }; styleReferenceAssetIds: string[] }
    expect(fake.callsTo('PATCH', `/projects/${PROJECT}`)[0]?.body).toEqual({
      styleGuide: '水彩',
      durationSec: 116,
      styleReferenceAssetIds: [ASSET],
    })
    expect(fake.callsTo('POST', `/projects/${PROJECT}/script/versions`)[0]?.body).toEqual({ content: '夏の歌', authoredBy: 'ai' })
    expect(result.styleReferenceAssetIds).toEqual([ASSET])
  })

  it('画面の向きを変えると、その向きの既定の大きさも一緒に PATCH する', async () => {
    const fake = createFakeApi([
      { method: 'PATCH', path: `/projects/${PROJECT}`, data: projectRow({ aspectRatio: '9:16', resolution: { width: 1080, height: 1920 } }) },
    ])
    jsonOf(await updateProjectTool.run({ projectId: PROJECT, aspectRatio: '9:16' }, depsFor(fake)))
    expect(fake.callsTo('PATCH', `/projects/${PROJECT}`)[0]?.body).toEqual({
      aspectRatio: '9:16',
      resolution: { width: 1080, height: 1920 },
    })
  })

  it('コンセプトだけなら PATCH しない', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}`, data: projectRow() },
      { method: 'POST', path: `/projects/${PROJECT}/script/versions`, status: 201, data: { version: { content: 'c' } } },
    ])
    jsonOf(await updateProjectTool.run({ projectId: PROJECT, concept: '冬の歌' }, depsFor(fake)))
    expect(fake.callsTo('PATCH', `/projects/${PROJECT}`)).toHaveLength(0)
  })

  it('何も変えない・手本画像が 4 枚・状態が知らない値なら API を呼ばずに断る', async () => {
    const fake = createFakeApi([])
    const four = Array.from({ length: 4 }, () => ({ mediaAssetId: ASSET }))
    for (const args of [
      { projectId: PROJECT },
      { projectId: PROJECT, styleReferences: four },
      { projectId: PROJECT, status: 'archived' },
      { projectId: PROJECT, aspectRatio: '3:2' },
    ]) {
      const result = await updateProjectTool.run(args, depsFor(fake))
      expect(result.isError).toBe(true)
    }
    expect(fake.calls).toHaveLength(0)
  })
})

describe('update_project の仕上げの音量（ADR-0060）', () => {
  it('選んだ仕上げを PATCH し、null は自動に戻す', async () => {
    const fake = createFakeApi([
      { method: 'PATCH', path: `/projects/${PROJECT}`, data: projectRow({ masteringMode: 'peak' }) },
    ])
    const result = jsonOf(await updateProjectTool.run({ projectId: PROJECT, masteringMode: 'peak' }, depsFor(fake))) as {
      project: { masteringMode?: string }
    }
    expect(fake.callsTo('PATCH', `/projects/${PROJECT}`)[0]?.body).toEqual({ masteringMode: 'peak' })
    expect(result.project.masteringMode).toBe('peak')

    const auto = createFakeApi([{ method: 'PATCH', path: `/projects/${PROJECT}`, data: projectRow({ masteringMode: null }) }])
    await updateProjectTool.run({ projectId: PROJECT, masteringMode: null }, depsFor(auto))
    expect(auto.callsTo('PATCH', `/projects/${PROJECT}`)[0]?.body).toEqual({ masteringMode: null })
  })
})

describe('update_project の確かめと危険度', () => {
  it('別の作品の素材を手本画像にしようとしたら PATCH しない', async () => {
    const fake = createFakeApi([ownedMedia(OTHER)])
    const result = await updateProjectTool.run({ projectId: PROJECT, styleReferences: [{ mediaAssetId: ASSET }] }, depsFor(fake))
    expect(textOf(result)).toContain('この作品に無い素材')
    expect(fake.calls.filter((c) => c.method !== 'GET')).toHaveLength(0)
  })

  it('予算を含むときだけ設定として確認し、ほかの直しはふつうの書き込み', () => {
    expect(updateProjectTool.risk).toBe('settings')
    expect(updateProjectTool.riskOf({ projectId: PROJECT, budgetUsd: 20 })).toBe('settings')
    expect(updateProjectTool.riskOf({ projectId: PROJECT, budgetUsd: null })).toBe('settings')
    expect(updateProjectTool.riskOf({ projectId: PROJECT, name: '新しい名前' })).toBe('write')
    // 読めない入力は重い方に倒す。
    expect(updateProjectTool.riskOf({ projectId: PROJECT, budgetUsd: -1 })).toBe('settings')
  })
})

describe('duplicate_project', () => {
  it('既定で全部を持っていき、依存の欠けた選び方は API の文を返す', async () => {
    const fake = createFakeApi([
      {
        method: 'POST',
        path: `/projects/${PROJECT}/duplicate`,
        status: 201,
        data: { project: projectRow({ id: OTHER, name: 'コピー' }), notes: [] },
      },
    ])
    const result = jsonOf(await duplicateProjectTool.run({ projectId: PROJECT, name: 'コピー' }, depsFor(fake))) as {
      project: { id: string }
    }
    expect(result.project.id).toBe(OTHER)
    const body = fake.callsTo('POST', `/projects/${PROJECT}/duplicate`)[0]?.body as { items: string[] }
    expect(body.items).toContain('takes')
    expect(body.items).toContain('concept')
  })

  it('同じ項目を 2 回・知らない項目は断る', async () => {
    const fake = createFakeApi([])
    expect((await duplicateProjectTool.run({ projectId: PROJECT, name: 'x', items: ['shots', 'shots'] }, depsFor(fake))).isError).toBe(true)
    expect((await duplicateProjectTool.run({ projectId: PROJECT, name: 'x', items: ['everything'] }, depsFor(fake))).isError).toBe(true)
    expect(fake.calls).toHaveLength(0)
  })
})

describe('import_from_project', () => {
  it('list は取り込み元の素材を並べ、効果音は音 1 本ずつにする', async () => {
    const base = `/projects/${OTHER}`
    const fake = createFakeApi([
      { method: 'GET', path: `${base}/characters`, data: [{ id: ulid('CH1'), name: 'hero', displayName: '戦子' }] },
      { method: 'GET', path: `${base}/locations`, data: [] },
      { method: 'GET', path: `${base}/brand-assets`, data: [] },
      { method: 'GET', path: `${base}/voices`, data: [{ id: ulid('VC1'), name: '戦子の声', tool: 'gemini_api' }] },
      { method: 'GET', path: `${base}/music-tracks`, data: [] },
      { method: 'GET', path: `${base}/sfx-jobs`, data: [{ id: ulid('SJ1'), prompt: '剣', mediaAssetIds: [ulid('MA1'), ulid('MA2')] }] },
    ])
    const result = jsonOf(
      await importFromProjectTool.run({ projectId: PROJECT, sourceProjectId: OTHER, action: 'list' }, depsFor(fake)),
    ) as { characters: unknown[]; sfxSounds: unknown[] }
    expect(result.characters).toEqual([{ id: ulid('CH1'), displayName: '戦子' }])
    expect(result.sfxSounds).toHaveLength(2)
  })

  it('import は取り込み先の口へ選んだものを送る', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${OTHER}/characters`, data: [{ id: ulid('CH1'), name: 'hero', displayName: '戦子' }] },
      {
        method: 'POST',
        path: `/projects/${PROJECT}/library-imports`,
        status: 201,
        data: {
          characters: [{ id: ulid('CH9'), name: 'hero', displayName: '戦子' }],
          locations: [],
          brandAssets: [],
          voices: [],
          musicTracks: [],
          sfxSounds: [],
        },
      },
    ])
    const result = jsonOf(
      await importFromProjectTool.run(
        { projectId: PROJECT, sourceProjectId: OTHER, action: 'import', characterIds: [ulid('CH1')] },
        depsFor(fake),
      ),
    ) as { characters: { id: string }[] }
    expect(result.characters[0]?.id).toBe(ulid('CH9'))
    expect(fake.callsTo('POST', `/projects/${PROJECT}/library-imports`)[0]?.body).toMatchObject({
      characterIds: [ulid('CH1')],
      sfxSounds: [],
    })
  })

  it('取り込み元の作品に無いものは取り込まない', async () => {
    const base = `/projects/${OTHER}`
    const fake = createFakeApi([
      { method: 'GET', path: `${base}/characters`, data: [{ id: ulid('CH1'), name: 'hero', displayName: '戦子' }] },
      { method: 'GET', path: `${base}/sfx-jobs`, data: [{ id: ulid('SJ1'), prompt: '剣', mediaAssetIds: [ulid('MA1')] }] },
    ])
    const character = await importFromProjectTool.run(
      { projectId: PROJECT, sourceProjectId: OTHER, action: 'import', characterIds: [ulid('CH1'), ulid('CH3')] },
      depsFor(fake),
    )
    expect(textOf(character)).toContain(ulid('CH3'))
    const sound = await importFromProjectTool.run(
      { projectId: PROJECT, sourceProjectId: OTHER, action: 'import', sfxSounds: [{ sfxJobId: ulid('SJ1'), mediaAssetId: ulid('MA2') }] },
      depsFor(fake),
    )
    expect(textOf(sound)).toContain('効果音')
    expect(fake.calls.filter((c) => c.method !== 'GET')).toHaveLength(0)
  })

  it('何も選ばない・取り込み元と先が同じなら断る', async () => {
    const fake = createFakeApi([])
    const empty = await importFromProjectTool.run({ projectId: PROJECT, sourceProjectId: OTHER, action: 'import' }, depsFor(fake))
    expect(textOf(empty)).toContain('取り込むもの')
    const same = await importFromProjectTool.run({ projectId: PROJECT, sourceProjectId: PROJECT, action: 'list' }, depsFor(fake))
    expect(same.isError).toBe(true)
    expect(fake.calls).toHaveLength(0)
  })
})

describe('edit_location', () => {
  const listed = { method: 'GET', path: `/projects/${PROJECT}/locations`, data: [{ id: LOC, name: '校庭' }] }

  it('参考画像を差し替え、渡した項目だけ PATCH する', async () => {
    const fake = createFakeApi([
      listed,
      ownedMedia(PROJECT),
      { method: 'PATCH', path: `/locations/${LOC}`, data: { id: LOC, name: '夜の校庭', referenceAssetIds: [ASSET] } },
    ])
    jsonOf(
      await editLocationTool.run(
        { projectId: PROJECT, locationId: LOC, action: 'update', name: '夜の校庭', references: [{ mediaAssetId: ASSET }] },
        depsFor(fake),
      ),
    )
    expect(fake.callsTo('PATCH', `/locations/${LOC}`)[0]?.body).toEqual({ name: '夜の校庭', referenceAssetIds: [ASSET] })
  })

  it('この作品の一覧に無い場所は消さない', async () => {
    const fake = createFakeApi([{ ...listed, data: [] }])
    const result = await editLocationTool.run({ projectId: PROJECT, locationId: LOC, action: 'delete' }, depsFor(fake))
    expect(textOf(result)).toContain('この作品に無い場所')
    expect(fake.callsTo('DELETE', `/locations/${LOC}`)).toHaveLength(0)
  })
})

describe('manage_brand_assets', () => {
  const path = `/projects/${PROJECT}/brand-assets`
  const color = { id: BRAND, category: 'color', name: '黄', mediaAssetId: null, value: '#FFD200', usageRule: '' }

  it('色は value で登録する', async () => {
    const fake = createFakeApi([{ method: 'POST', path, status: 201, data: color }])
    const result = jsonOf(
      await manageBrandAssetsTool.run({ projectId: PROJECT, action: 'add', category: 'color', name: '黄', value: '#FFD200' }, depsFor(fake)),
    ) as { brandAsset: { value: string } }
    expect(result.brandAsset.value).toBe('#FFD200')
    expect(fake.callsTo('POST', path)[0]?.body).toEqual({ category: 'color', name: '黄', value: '#FFD200' })
  })

  it('ロゴに画像が無い・色の形が違うなら API を呼ばない', async () => {
    const fake = createFakeApi([])
    const noImage = await manageBrandAssetsTool.run({ projectId: PROJECT, action: 'add', category: 'logo', name: 'ロゴ' }, depsFor(fake))
    expect(noImage.isError).toBe(true)
    const badColor = await manageBrandAssetsTool.run(
      { projectId: PROJECT, action: 'add', category: 'color', name: '黄', value: 'yellow' },
      depsFor(fake),
    )
    expect(badColor.isError).toBe(true)
    expect(fake.calls).toHaveLength(0)
  })

  it('一覧にあるものだけ消す', async () => {
    const fake = createFakeApi([
      { method: 'GET', path, data: [color] },
      { method: 'DELETE', path: `/brand-assets/${BRAND}`, status: 204 },
    ])
    jsonOf(await manageBrandAssetsTool.run({ projectId: PROJECT, action: 'delete', brandAssetId: BRAND }, depsFor(fake)))
    expect(fake.callsTo('DELETE', `/brand-assets/${BRAND}`)).toHaveLength(1)
    const other = await manageBrandAssetsTool.run({ projectId: PROJECT, action: 'delete', brandAssetId: ulid('BR2') }, depsFor(fake))
    expect(other.isError).toBe(true)
    expect(fake.callsTo('DELETE', /brand-assets/)).toHaveLength(1)
  })
})
