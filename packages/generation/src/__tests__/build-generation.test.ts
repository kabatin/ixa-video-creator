import {
  DurationNotSupportedError,
  MediaAssetId as MediaAssetIdSchema,
  ModelId as ModelIdSchema,
  ProjectId as ProjectIdSchema,
  ShotReferenceId as ShotReferenceIdSchema,
  newId,
  type GenerationContextSource,
  type ModelId,
  type ReferenceRole,
  type RouterDecision,
  type Shot,
  type ShotGenerationSpec,
  type ShotReference,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  SpecCompilationError,
  buildGeneration,
  type BuildGenerationDeps,
  type GenerationModel,
  type GenerationProject,
} from '../build-generation.js'
import { aShot } from '../testing.js'

/**
 * `buildGeneration` の単体テスト。
 *
 * ここが確かめるのは **組み立ての手順**である。
 * 参照解決の規則（何を捨てるか）は packages/domain、モデル選択のスコアリングは
 * packages/providers/core のテストが見る。二重に検証しない。
 *
 * provider-core は import できない（eslint boundaries）。
 * Port が構造的な型であることを、ここで偽物を渡せる事実そのものが示している。
 */

const projectId = newId(ProjectIdSchema)

const aProject = (overrides: Partial<GenerationProject> = {}): GenerationProject => ({
  aspectRatio: '16:9',
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  styleGuide: 'cinematic, high contrast',
  styleReferenceAssetIds: [],
  ...overrides,
})

const ALL_ROLES: readonly ReferenceRole[] = [
  'subject',
  'wardrobe',
  'location',
  'style',
  'brand',
  'start_frame',
  'end_frame',
  'previous_shot_last_frame',
]

type TestModel = GenerationModel & { readonly label: string }

const aModel = (
  id: string,
  capabilities: Partial<GenerationModel['capabilities']> = {},
): TestModel => ({
  id: ModelIdSchema.parse(id),
  label: id,
  capabilities: {
    durations: { mode: 'enum', values: [4, 6, 8] },
    referenceImages: { max: 3, roles: ALL_ROLES },
    ...capabilities,
  },
})

/** 4/6/8 秒・参照 3 枚。Veo 相当。 */
const modelA = aModel('test/model-a')
/** 5/10 秒・参照 9 枚・start_frame 非対応。枠が広いモデル。 */
const modelB = aModel('test/model-b', {
  durations: { mode: 'enum', values: [5, 10] },
  referenceImages: { max: 9, roles: ALL_ROLES.filter((r) => r !== 'start_frame') },
})

const emptyContext: GenerationContextSource = {
  charactersForShot: () => Promise.resolve([]),
  locationsForShot: () => Promise.resolve([]),
  manualReferencesForShot: () => Promise.resolve([]),
  previousShotLastFrame: () => Promise.resolve(null),
  startFrame: () => Promise.resolve(null),
}

const contextWith = (parts: Partial<GenerationContextSource>): GenerationContextSource => ({
  ...emptyContext,
  ...parts,
})

const aManualReference = (shot: Shot, role: ReferenceRole, order: number): ShotReference => ({
  id: newId(ShotReferenceIdSchema),
  shotId: shot.id,
  mediaAssetId: newId(MediaAssetIdSchema),
  role,
  weight: 1,
  order,
  sourceKind: 'manual',
})

/** 呼び出しを記録するだけの catalog。ProviderRegistry と同じ形をしている。 */
const catalogOf = (models: readonly TestModel[]) => {
  const lookups: ModelId[] = []
  return {
    lookups,
    port: {
      allModels: (): readonly TestModel[] => models,
      findModel: (modelId: ModelId): TestModel => {
        lookups.push(modelId)
        const found = models.find((m) => m.id === modelId)
        // 本物の ProviderRegistry と同じく、見つからないときは例外にする。
        if (found === undefined) throw new Error(`未登録のモデルです: ${modelId}`)
        return found
      },
    },
  }
}

type RouterOptions = {
  /** 選ぶモデル。既定は候補の末尾（先頭をそのまま使っていないことを見るため）。 */
  readonly pick?: (models: readonly TestModel[]) => TestModel
  /** validateAgainstCapabilities が返す違反。既定は違反なし。 */
  readonly violations?: readonly string[]
}

const routerOf = (options: RouterOptions = {}) => {
  const drafts: ShotGenerationSpec[] = []
  const validated: { spec: ShotGenerationSpec; model: TestModel }[] = []
  return {
    drafts,
    validated,
    port: {
      selectModel: (spec: ShotGenerationSpec, models: readonly TestModel[]): RouterDecision => {
        drafts.push(spec)
        const picked = options.pick?.(models) ?? models[models.length - 1]
        if (picked === undefined) throw new Error('候補が空です')
        return {
          modelId: picked.id,
          score: 1,
          reason: 'テスト用の固定選択',
          rejected: [],
          weightsVersion: 'test-v1',
        }
      },
      validateAgainstCapabilities: (
        spec: ShotGenerationSpec,
        model: TestModel,
      ): readonly string[] => {
        validated.push({ spec, model })
        return options.violations ?? []
      },
    },
  }
}

const depsOf = (
  models: readonly TestModel[],
  context: GenerationContextSource = emptyContext,
  routerOptions: RouterOptions = {},
) => {
  const catalog = catalogOf(models)
  const router = routerOf(routerOptions)
  const deps: BuildGenerationDeps<TestModel> = {
    context,
    catalog: catalog.port,
    router: router.port,
  }
  return { deps, catalog, router }
}

describe('buildGeneration — モデルを明示したとき', () => {
  it('要求したモデルだけを使い、router を呼ばない', async () => {
    const shot = aShot(projectId)
    const { deps, router } = depsOf([modelA, modelB])

    const compiled = await buildGeneration(deps, shot, aProject(), modelA.id)

    expect(compiled.model.id).toBe(modelA.id)
    expect(compiled.routerDecision).toBeNull()
    expect(router.drafts).toHaveLength(0)
  })

  /**
   * Shot に付けた最初のフレーム（手動の start_frame 参照・ADR-0025）は、画像を動かすだけの
   * モデルでも仕様に入る。他の役割はそのモデルが受けないので落ちる。
   */
  it('手動の最初のフレームは、start_frame だけを受けるモデルの仕様に入る', async () => {
    const shot = aShot(projectId)
    const stillMotion = aModel('local/still-motion', {
      durations: { mode: 'range', min: 0.5, max: 60 },
      referenceImages: { max: 1, roles: ['start_frame'] },
    })
    const startFrame = aManualReference(shot, 'start_frame', 0)
    const context = contextWith({
      manualReferencesForShot: () => Promise.resolve([aManualReference(shot, 'subject', 1), startFrame]),
    })
    const { deps } = depsOf([stillMotion], context)

    const compiled = await buildGeneration(deps, shot, aProject(), stillMotion.id)

    expect(compiled.spec.references).toEqual([
      { mediaAssetId: startFrame.mediaAssetId, role: 'start_frame', weight: 1 },
    ])
  })

  it('編集尺をモデルが出せる尺へ切り上げる', async () => {
    const shot = aShot(projectId) // 編集尺 3.75 秒
    const { deps } = depsOf([modelA])

    const compiled = await buildGeneration(deps, shot, aProject(), modelA.id)

    // 4/6/8 のうち 3.75 を満たす最小値。切り下げない（ADR-0011）。
    expect(compiled.spec.durationSec).toBe(4)
  })

  it('未登録のモデルを要求したら catalog の例外をそのまま通す', async () => {
    const shot = aShot(projectId)
    const { deps } = depsOf([modelA])

    await expect(
      buildGeneration(deps, shot, aProject(), ModelIdSchema.parse('test/unknown')),
    ).rejects.toThrow('未登録のモデルです')
  })

  it('モデルが出せない尺なら DurationNotSupportedError を握り潰さない', async () => {
    // 4/6/8 秒しか出せないモデルに 17 秒を要求する。8 秒で作って 0.5 倍速でも埋まらない（ADR-0011 追記）。
    const shot = aShot(projectId, { durationSec: 17 })
    const { deps } = depsOf([modelA])

    await expect(buildGeneration(deps, shot, aProject(), modelA.id)).rejects.toBeInstanceOf(
      DurationNotSupportedError,
    )
  })
})

describe('buildGeneration — AUTO のとき', () => {
  it('全モデルの能力の和で下書きを作り、router に渡す', async () => {
    const shot = aShot(projectId)
    const context = contextWith({
      manualReferencesForShot: () =>
        Promise.resolve([
          aManualReference(shot, 'subject', 0),
          aManualReference(shot, 'wardrobe', 1),
          aManualReference(shot, 'location', 2),
          aManualReference(shot, 'style', 3),
        ]),
    })
    const { deps, router } = depsOf([modelA, modelB], context)

    await buildGeneration(deps, shot, aProject(), 'AUTO')

    const draft = router.drafts[0]
    expect(draft).toBeDefined()
    // 参照枠は和（3 と 9 の大きいほう）なので 4 枚とも残る。
    expect(draft?.references).toHaveLength(4)
    // 下書きの尺は編集尺のまま。切り上げはモデルが決まってから行う。
    expect(draft?.durationSec).toBe(3.75)
  })

  it('router が選んだモデルを catalog から引き直して使う', async () => {
    const shot = aShot(projectId)
    const { deps, catalog } = depsOf([modelA, modelB], emptyContext, { pick: () => modelB })

    const compiled = await buildGeneration(deps, shot, aProject(), 'AUTO')

    expect(compiled.model.id).toBe(modelB.id)
    expect(catalog.lookups).toEqual([modelB.id])
    expect(compiled.routerDecision?.modelId).toBe(modelB.id)
  })

  it('最終的な仕様は選ばれたモデルの能力で組み直す', async () => {
    const shot = aShot(projectId)
    const context = contextWith({
      manualReferencesForShot: () =>
        Promise.resolve([
          aManualReference(shot, 'subject', 0),
          aManualReference(shot, 'wardrobe', 1),
          aManualReference(shot, 'location', 2),
          aManualReference(shot, 'style', 3),
        ]),
    })
    const { deps, router } = depsOf([modelA, modelB], context, {
      pick: () => modelA,
    })

    const compiled = await buildGeneration(deps, shot, aProject(), 'AUTO')

    // 下書きは 4 枚だったが、modelA の上限 3 枚へ切り詰められている。
    expect(router.drafts[0]?.references).toHaveLength(4)
    expect(compiled.spec.references).toHaveLength(3)
    // 尺も modelA の対応値へ切り上がる。
    expect(compiled.spec.durationSec).toBe(4)
  })

  it('選ばれたモデルが対応しないロールは最終仕様から落ちる', async () => {
    const shot = aShot(projectId)
    const startFrameId = newId(MediaAssetIdSchema)
    const context = contextWith({ startFrame: () => Promise.resolve(startFrameId) })
    // modelB は start_frame 非対応。
    const { deps } = depsOf([modelA, modelB], context, { pick: () => modelB })

    const compiled = await buildGeneration(deps, shot, aProject(), 'AUTO')

    expect(compiled.spec.references).toHaveLength(0)
  })

  it('使えるモデルが 1 つも無ければ既定値で埋めず SpecCompilationError にする', async () => {
    const shot = aShot(projectId)
    const { deps, router } = depsOf([])

    await expect(buildGeneration(deps, shot, aProject(), 'AUTO')).rejects.toBeInstanceOf(
      SpecCompilationError,
    )
    expect(router.drafts).toHaveLength(0)
  })
})

describe('buildGeneration — 能力検査', () => {
  it('違反があれば理由をすべて並べて SpecCompilationError にする', async () => {
    const shot = aShot(projectId)
    const { deps } = depsOf([modelA], emptyContext, {
      violations: ['fps 30 に非対応', '解像度 1920x1080 に非対応'],
    })

    await expect(buildGeneration(deps, shot, aProject(), modelA.id)).rejects.toThrow(
      `モデル ${modelA.id} では生成できません: fps 30 に非対応 / 解像度 1920x1080 に非対応`,
    )
  })

  it('検査するのは組み直したあとの最終仕様である', async () => {
    const shot = aShot(projectId)
    const { deps, router } = depsOf([modelA, modelB], emptyContext, { pick: () => modelA })

    const compiled = await buildGeneration(deps, shot, aProject(), 'AUTO')

    expect(router.validated).toHaveLength(1)
    expect(router.validated[0]?.model.id).toBe(modelA.id)
    expect(router.validated[0]?.spec).toEqual(compiled.spec)
  })
})

describe('buildGeneration — 参照と specHash', () => {
  it('context の 5 つの口をすべて読み、参照を仕様に載せる', async () => {
    const shot = aShot(projectId)
    const called: string[] = []
    const previousFrameId = newId(MediaAssetIdSchema)
    const context: GenerationContextSource = {
      charactersForShot: () => {
        called.push('characters')
        return Promise.resolve([])
      },
      locationsForShot: () => {
        called.push('locations')
        return Promise.resolve([])
      },
      manualReferencesForShot: () => {
        called.push('manual')
        return Promise.resolve([aManualReference(shot, 'subject', 0)])
      },
      previousShotLastFrame: () => {
        called.push('previousFrame')
        return Promise.resolve(previousFrameId)
      },
      startFrame: () => {
        called.push('startFrame')
        return Promise.resolve(null)
      },
    }
    const { deps } = depsOf([modelA], context)

    const compiled = await buildGeneration(deps, shot, aProject(), modelA.id)

    expect(called.sort()).toEqual([
      'characters',
      'locations',
      'manual',
      'previousFrame',
      'startFrame',
    ])
    expect(compiled.spec.references.map((r) => r.role)).toEqual([
      'subject',
      'previous_shot_last_frame',
    ])
  })

  it('同じ入力からは同じ specHash が出る', async () => {
    const shot = aShot(projectId)
    const first = await buildGeneration(depsOf([modelA]).deps, shot, aProject(), modelA.id)
    const second = await buildGeneration(depsOf([modelA]).deps, shot, aProject(), modelA.id)

    expect(first.specHash).toBe(second.specHash)
    expect(first.specHash).toHaveLength(64)
  })

  it('スタイルガイドが変われば specHash も変わる', async () => {
    const shot = aShot(projectId)
    const base = await buildGeneration(depsOf([modelA]).deps, shot, aProject(), modelA.id)
    const changed = await buildGeneration(
      depsOf([modelA]).deps,
      shot,
      aProject({ styleGuide: 'documentary, natural light' }),
      modelA.id,
    )

    expect(changed.specHash).not.toBe(base.specHash)
  })

  it('モデルが変われば生成尺が変わり specHash も変わる', async () => {
    const shot = aShot(projectId)
    const withA = await buildGeneration(depsOf([modelA, modelB]).deps, shot, aProject(), modelA.id)
    const withB = await buildGeneration(depsOf([modelA, modelB]).deps, shot, aProject(), modelB.id)

    expect(withA.spec.durationSec).toBe(4)
    expect(withB.spec.durationSec).toBe(5)
    expect(withA.specHash).not.toBe(withB.specHash)
  })
})

/**
 * レビューの指摘から人が選んだ直し（PHASE 6.1）。
 *
 * ここで守るのは 2 つ。**直しを添えないときは何も変わらない**ことと、
 * **下書きと本番の両方のコンパイルへ同じ直しが届く**こと。
 * 後者が抜けると router が見た仕様と最終的な仕様が食い違い、
 * 選ばれたモデルの根拠が実際に生成される内容とずれる。
 */
describe('buildGeneration — 指摘の直し（corrections）', () => {
  it('添えなければ仕様にキーが現れず、ハッシュも変わらない', async () => {
    const shot = aShot(projectId)

    const plain = await buildGeneration(depsOf([modelA]).deps, shot, aProject(), modelA.id)
    const empty = await buildGeneration(depsOf([modelA]).deps, shot, aProject(), modelA.id, {})
    const explicitlyEmpty = await buildGeneration(
      depsOf([modelA]).deps,
      shot,
      aProject(),
      modelA.id,
      { corrections: [] },
    )

    expect('corrections' in plain.spec).toBe(false)
    expect(empty.specHash).toBe(plain.specHash)
    expect(explicitlyEmpty.specHash).toBe(plain.specHash)
  })

  it('添えると仕様に載り、プロンプトの末尾に付き、別のハッシュになる', async () => {
    const shot = aShot(projectId)

    const plain = await buildGeneration(depsOf([modelA]).deps, shot, aProject(), modelA.id)
    const corrected = await buildGeneration(depsOf([modelA]).deps, shot, aProject(), modelA.id, {
      corrections: ['顔をもっと近く'],
    })

    expect(corrected.spec.corrections).toEqual(['顔をもっと近く'])
    expect(corrected.spec.prompt).toContain('顔をもっと近く')
    expect(corrected.spec.prompt.startsWith(plain.spec.prompt)).toBe(true)
    // 別のハッシュでないと、直した生成が「同じ仕様の Take が既にある」と判定される。
    expect(corrected.specHash).not.toBe(plain.specHash)
  })

  it('AUTO のとき router へ渡す下書きにも直しが載る', async () => {
    const shot = aShot(projectId)
    const { deps, router } = depsOf([modelA, modelB])

    const compiled = await buildGeneration(deps, shot, aProject(), 'AUTO', {
      corrections: ['光を強く'],
    })

    // 下書きと本番で違う仕様をモデルに見せない。
    expect(router.drafts).toHaveLength(1)
    expect(router.drafts[0]?.corrections).toEqual(['光を強く'])
    expect(compiled.spec.corrections).toEqual(['光を強く'])
  })
})
