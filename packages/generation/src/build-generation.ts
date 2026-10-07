import {
  compileSpec,
  computeSpecHash,
  quantizeDuration,
  resolveReferences,
  type DurationSupport,
  type GenerationContextSource,
  type ModelId,
  type Project,
  type ReferenceRole,
  type RouterDecision,
  type Shot,
  type ShotGenerationSpec,
} from '@ixa/domain'

/**
 * Shot から生成仕様を組み立てる処理（ARCHITECTURE.md §11）。
 *
 * **api と worker の両方が呼ぶため packages に置く**（L-012）。
 * 生成ジョブを作るには仕様のコンパイルとモデル選択が必要で、
 * その実装が片側にしか無いと必ず `spec_drift` で破綻する。
 *
 * `packages/*` は `packages/providers/*` を import できない（eslint boundaries /
 * ARCHITECTURE.md §4）。そのため `ProviderRegistry` や `VideoModelDescriptor` を
 * 名指しせず、**実際に使う口だけ**を構造的な型として受け取る。
 * provider-core の実装はこれらの形を構造的に満たすので、アダプタは要らない。
 */

/**
 * 仕様の組み立てが知る必要のあるモデルの情報。
 *
 * `VideoModelDescriptor` はこの形の上位互換なので、そのまま `M` として渡せる。
 * ここに書いていないもの（qualities / economics / providerId）は
 * 組み立てでは使わない。使うのは Router とコスト見積りであり、どちらも外側の責務。
 */
export type GenerationModel = {
  readonly id: ModelId
  readonly capabilities: {
    readonly durations: DurationSupport
    readonly referenceImages: {
      readonly max: number
      readonly roles: readonly ReferenceRole[]
    }
  }
}

/**
 * 使えるモデルを引く Port。`ProviderRegistry` がそのまま満たす。
 *
 * `findModel` は **見つからないとき例外を投げる**契約であり、null を返さない。
 * 「無いモデルを黙って既定値に差し替える」と、利用者が要求したのと別のモデルで
 * 生成が走り、出来上がった動画を見るまで誰も気づけない（L-015）。
 */
export type ModelCatalogPort<M extends GenerationModel> = {
  allModels(): readonly M[]
  findModel(modelId: ModelId): M
}

/**
 * モデル選択と能力検査の Port。
 * provider-core の `selectModel` / `validateAgainstCapabilities` がそのまま満たす。
 */
export type ModelRouterPort<M extends GenerationModel> = {
  /** 下書き仕様から使うモデルを決める。満たせるモデルが無ければ例外。 */
  selectModel(spec: ShotGenerationSpec, models: readonly M[]): RouterDecision
  /** 仕様がモデルの能力に収まるかを検査し、満たせない理由をすべて返す。 */
  validateAgainstCapabilities(spec: ShotGenerationSpec, model: M): readonly string[]
}

/** 参照の読み出しと、モデルに関する 2 つの Port。IO はすべてここから入る。 */
export type BuildGenerationDeps<M extends GenerationModel> = {
  readonly context: GenerationContextSource
  readonly catalog: ModelCatalogPort<M>
  readonly router: ModelRouterPort<M>
}

/** 仕様の組み立てに必要な Project の属性だけ。予算や状態はここでは使わない。 */
export type GenerationProject = Pick<Project, 'aspectRatio' | 'resolution' | 'fps' | 'styleGuide' | 'styleReferenceAssetIds'>

/** 組み上がった生成仕様と、それを出したモデル。 */
export type CompiledGeneration<M extends GenerationModel> = {
  readonly spec: ShotGenerationSpec
  readonly specHash: string
  readonly model: M
  readonly routerDecision: RouterDecision | null
}

/**
 * 1 回の生成に添える任意の指定。
 *
 * **直しは下書きと本番の両方のコンパイルへ渡る。** 片方だけに渡すと router が
 * 見ている仕様と最終的な仕様が食い違い、選ばれたモデルの根拠がずれる。
 */
export type BuildGenerationOptions = {
  /** レビューの指摘から人が選んだ直し（PHASE 6.1）。空なら仕様にキーを置かない。 */
  readonly corrections?: readonly string[]
  /**
   * 使うシード（ADR-0042 の「本番で作り直す」）。**省略は「Provider に任せる」**（従来どおり）。
   *
   * 試作で気に入った絵を本番の解像度で作り直すとき、同じシードから始めたい。
   * `null` と `undefined` を区別しない（どちらも任せる）。
   *
   * **仕様に載るので specHash が変わる。** 変わってよい（シードが違えば別の仕様）。
   * 同じシードで同じモデルなら、重複の警告が正しく出る。
   */
  readonly seed?: number | null
}

/** 仕様を組めない理由。呼び出し側が 422 へ変換する。 */
export class SpecCompilationError extends Error {
  override readonly name = 'SpecCompilationError'
}

const unionCapabilities = <M extends GenerationModel>(models: readonly M[]) => ({
  maxReferences: Math.max(0, ...models.map((m) => m.capabilities.referenceImages.max)),
  supportedRoles: [
    ...new Set(
      models.flatMap((m): readonly ReferenceRole[] => m.capabilities.referenceImages.roles),
    ),
  ],
})

/**
 * Shot・Project・参照から生成仕様を組み立てる。
 *
 * AUTO のときはモデルが決まるまで参照枚数も生成尺も確定できないため、
 * まず全モデルの能力の和で下書きを作って router に渡し、
 * 選ばれたモデルの能力で組み直す。最終的な specHash は 2 周目のものだけを使う。
 */
export const buildGeneration = async <M extends GenerationModel>(
  deps: BuildGenerationDeps<M>,
  shot: Shot,
  project: GenerationProject,
  requestedModel: ModelId | 'AUTO',
  options: BuildGenerationOptions = {},
): Promise<CompiledGeneration<M>> => {
  const { corrections = [], seed = null } = options
  const candidates =
    requestedModel === 'AUTO' ? deps.catalog.allModels() : [deps.catalog.findModel(requestedModel)]
  const first = candidates[0]
  // 候補ゼロを既定値で埋めない。モデルが 1 つも無いのは設定の欠落であり、生成を止める。
  if (first === undefined) throw new SpecCompilationError('利用できるモデルがありません')

  const [characters, locations, manualReferences, previousShotLastFrameId, startFrameId] =
    await Promise.all([
      deps.context.charactersForShot(shot.id),
      deps.context.locationsForShot(shot.id),
      deps.context.manualReferencesForShot(shot.id),
      deps.context.previousShotLastFrame(shot.id),
      deps.context.startFrame(shot.id),
    ])

  const compileFor = (
    maxReferences: number,
    supportedRoles: readonly ReferenceRole[],
    generationDurationSec: number,
  ): ShotGenerationSpec => {
    const references = resolveReferences({
      characters,
      locations,
      manualReferences,
      previousShotLastFrameId,
      startFrameId,
      // 作品の手本画像（ADR-0030）。
      styleReferenceIds: project.styleReferenceAssetIds,
      maxReferences,
      supportedRoles,
    })
    return compileSpec({
      project,
      shot,
      characters,
      references,
      generationDurationSec,
      seed,
      negativePrompt: null,
      corrections,
    })
  }

  const routeAuto = (): RouterDecision => {
    const union = unionCapabilities(candidates)
    // 下書きの尺は編集尺のまま渡す。router はモデルごとに切り上げて見積もる。
    const draft = compileFor(union.maxReferences, union.supportedRoles, shot.durationSec)
    return deps.router.selectModel(draft, candidates)
  }

  const routerDecision = requestedModel === 'AUTO' ? routeAuto() : null
  const chosen = routerDecision === null ? first : deps.catalog.findModel(routerDecision.modelId)

  const caps = chosen.capabilities
  const spec = compileFor(
    caps.referenceImages.max,
    caps.referenceImages.roles,
    quantizeDuration(shot.durationSec, caps.durations),
  )

  const violations = deps.router.validateAgainstCapabilities(spec, chosen)
  if (violations.length > 0) {
    throw new SpecCompilationError(
      `モデル ${chosen.id} では生成できません: ${violations.join(' / ')}`,
    )
  }

  return { spec, specHash: await computeSpecHash(spec), model: chosen, routerDecision }
}
