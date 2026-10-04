import type { ShotId } from '../common/ids.js'

/**
 * 費用を**出どころで割って**集計する（PHASE 6.3）。
 *
 * 既存の `summarizeCost`（cost-guard.ts）は実測の合計だけを出す。こちらはそれを置き換えず、
 * 「その額がどこから来たか」を足す。
 *
 * 理由は実データにある。本制作の Take 50 件はすべてスタブ Provider で、スタブの単価は 0 なので、
 * 額だけを出すと「$0 / $300 使用、余裕あり」と読める。だが実際には一度も実 Provider を回していない。
 * **額が 0 なのと、費用が発生していないのは違う。** 件数を必ず連れて来ることで、この取り違えを防ぐ。
 */

export type CostBucket = {
  readonly takeCount: number
  readonly totalUsd: number
}

/** 実測として数えた Provider 1 つ分。**名前を必ず連れて来る。** */
export type ProviderCost = {
  readonly providerId: string
  readonly takeCount: number
  readonly totalUsd: number
}

/**
 * 実 Provider で生成した分。
 *
 * **`byProvider` は「額では気付けない取り違え」を見えるようにするためにある。**
 * スタブの一覧に載せ忘れた Provider の Take は、ここに黙って流れ込む。
 * 額は 0 なので「実測 $0.00」としか出ず、載せ忘れに誰も気付けない。
 * 名前を並べれば「実測 $0.00（stub-v2 が 40 件）」と読めて、その場で分かる。
 */
export type MeasuredBucket = CostBucket & {
  /** providerId の昇順。件数が 0 の Provider は載せない。 */
  readonly byProvider: readonly ProviderCost[]
}

/**
 * Shot 1 つ分の内訳。**額と件数で単位が違うので、名前で区別する。**
 *
 * スタブの額は常に 0 なので、額で持つとこの欄は何も語らない。
 * 件数なら「この Shot を何回焼いたか」が読める。
 * 逆に実 Provider は額に意味があるので、そちらは額のまま持つ。
 */
export type ShotCost = {
  readonly measuredUsd: number
  readonly stubTakeCount: number
}

/**
 * `byShot` に載せられなかった Take。**捨てずに残す。**
 *
 * 論理削除された Shot の Take がここに来る。払った額は Shot を消しても戻らないので、
 * 合計には入れる。だが行としては出しようがないので、内訳の合計と全体の合計がズレる。
 * **そのズレを黙って捨てると、内訳を足し算した人が合計と合わずに混乱する**（lessons L-015）。
 */
export type UnlistedShotCost = {
  /** 溢れた Take の全件。実測とスタブの合計。 */
  readonly takeCount: number
  readonly measuredUsd: number
  /**
   * **件数で持つ**（`ShotCost.stubTakeCount` と同じ理由）。
   *
   * スタブの額は常に 0 なので、額では欄が何も語らない。
   * 件数なら `takeCount` との差から実測が何件かも引ける。
   * 同じ概念が場所によって額だったり件数だったりするのが、いちばん間違いを招く。
   */
  readonly stubTakeCount: number
}

export type CostMeter = {
  /** **null は「未設定」。0 ではない**（lessons L-021）。0 は「予算ゼロ」という別の状態。 */
  readonly budgetUsd: number | null
  /** 実 Provider で生成した分。**ここが 0 件なら額に意味は無い。** */
  readonly measured: MeasuredBucket
  /** スタブで生成した分。額は 0 だが、件数は「何回回したか」を表す。 */
  readonly stub: CostBucket
  /** **`listedShotIds` に載っている Shot だけ**の内訳。合計とは一致しないことがある。 */
  readonly byShot: ReadonlyMap<ShotId, ShotCost>
  /** `byShot` から溢れた分。合計には入っている。 */
  readonly unlistedShots: UnlistedShotCost
  /**
   * Take 以外で払った額（絵コンテ下書き・レビューなど）。
   *
   * **これを数えないと予算が実際より軽く見える。** 実際に絵コンテ下書きを
   * 1 回回して $0.38 を払ったのに、メーターは $0.00 のままだった（2026-09-18）。
   * 生成だけが金を使うわけではない。
   */
  readonly otherRuns: readonly OtherRunCost[]
  /**
   * 作品の複製で写した Take（件数と、元の作品で払った額）。**この作品の費用・予算には入れない。**
   * 0 円にして数えると件数が実測やスタブに紛れるので、別の欄にする。
   */
  readonly copied: CostBucket
  /**
   * **予算と突き合わせるのはこの額。** 実測の Take と `otherRuns` の合計。
   * スタブの分は入らない（額が 0 なので入れても変わらないが、意味が違う）。
   */
  readonly totalUsd: number
}

/** Take 以外の実行の集計。`kind` は `storyboard_draft` のような符号で、言葉は画面が持つ。 */
export type OtherRunCost = {
  readonly kind: string
  readonly runCount: number
  readonly totalUsd: number
}

/** 1 件も無いバケツ。合計を 0 で始めるための値。 */
const EMPTY_BUCKET: CostBucket = Object.freeze({ takeCount: 0, totalUsd: 0 })

const addToBucket = (bucket: CostBucket, costUsd: number): CostBucket => ({
  takeCount: bucket.takeCount + 1,
  totalUsd: bucket.totalUsd + costUsd,
})

export type CostMeterTake = {
  readonly shotId: ShotId
  readonly costUsd: number
  readonly providerId: string
  /** 作品の複製で写した Take か（`countsAsSpend` の逆）。元の作品で払った分なので、この作品の費用に入れない。 */
  readonly copied: boolean
}

export type CostMeterInput = {
  readonly budgetUsd: number | null
  readonly takes: readonly CostMeterTake[]
  /**
   * どの Provider がスタブかは **domain が知らない**。呼ぶ側が渡す。
   *
   * ここに `'stub'` と書くと、Provider の素性（`packages/providers` の話）が domain に流れ込み、
   * 依存の向きが逆流する（ARCHITECTURE §4）。
   *
   * **この一覧に無い ID はすべて実測として数える。** 載せ忘れても額では気付けないので、
   * 数えた Provider の名前を `measured.byProvider` に出す。
   */
  readonly stubProviderIds: readonly string[]
  /**
   * `byShot` に行として出せる Shot。**null は「絞らない」**（全 Take を Shot ごとに載せる）。
   *
   * 論理削除された Shot を落とすために呼ぶ側が渡す。落とした分は捨てず `unlistedShots` に残る。
   */
  readonly listedShotIds: readonly ShotId[] | null
  /**
   * Take 以外で払った額。**呼ぶ側が種類ごとに畳んで渡す。**
   * 集計の元（下書きの run / レビューの run）は domain の外にあるため。
   */
  readonly otherRuns?: readonly OtherRunCost[]
}

/** Provider ごとの集計を、名前の昇順の配列へ畳む。 */
const toProviderCosts = (byProvider: ReadonlyMap<string, CostBucket>): readonly ProviderCost[] =>
  [...byProvider]
    .map(([providerId, bucket]) => ({ providerId, ...bucket }))
    .sort((a, b) => (a.providerId < b.providerId ? -1 : 1))

/**
 * Take を出どころで 2 つに割って集計する。
 *
 * 振り分けは **Provider の素性だけ**で決める。額では決めない。
 * 実 Provider が 0 ドルを返した Take は「実測 $0」であって、スタブではない。
 */
export const buildCostMeter = (input: CostMeterInput): CostMeter => {
  const stubIds = new Set(input.stubProviderIds)
  const listed = input.listedShotIds === null ? null : new Set(input.listedShotIds)

  const byShot = new Map<ShotId, ShotCost>()
  const measuredByProvider = new Map<string, CostBucket>()

  let measured = EMPTY_BUCKET
  let stub = EMPTY_BUCKET
  let copied = EMPTY_BUCKET
  let unlisted: UnlistedShotCost = { takeCount: 0, measuredUsd: 0, stubTakeCount: 0 }

  for (const take of input.takes) {
    // 複製した Take は元の作品で払った分。この作品のどの欄にも入れず、件数と元の額だけ別に数える。
    if (take.copied) {
      copied = addToBucket(copied, take.costUsd)
      continue
    }
    const isStub = stubIds.has(take.providerId)

    if (isStub) {
      stub = addToBucket(stub, take.costUsd)
    } else {
      measured = addToBucket(measured, take.costUsd)
      measuredByProvider.set(
        take.providerId,
        addToBucket(measuredByProvider.get(take.providerId) ?? EMPTY_BUCKET, take.costUsd),
      )
    }

    // 行として出せない Shot の分は、合計に入れたまま別枠へ寄せる。黙って落とさない。
    if (listed !== null && !listed.has(take.shotId)) {
      unlisted = {
        takeCount: unlisted.takeCount + 1,
        measuredUsd: unlisted.measuredUsd + (isStub ? 0 : take.costUsd),
        stubTakeCount: unlisted.stubTakeCount + (isStub ? 1 : 0),
      }
      continue
    }

    const current = byShot.get(take.shotId) ?? { measuredUsd: 0, stubTakeCount: 0 }
    byShot.set(
      take.shotId,
      isStub
        ? { measuredUsd: current.measuredUsd, stubTakeCount: current.stubTakeCount + 1 }
        : { measuredUsd: current.measuredUsd + take.costUsd, stubTakeCount: current.stubTakeCount },
    )
  }

  // **0 件の種類は落とす。** 「レビュー 0 件 $0.00」を並べても読み手には情報が無い。
  const otherRuns = (input.otherRuns ?? []).filter((run) => run.runCount > 0)
  const otherUsd = otherRuns.reduce((total, run) => total + run.totalUsd, 0)

  return {
    budgetUsd: input.budgetUsd,
    measured: { ...measured, byProvider: toProviderCosts(measuredByProvider) },
    stub,
    byShot,
    unlistedShots: unlisted,
    otherRuns,
    copied,
    // 予算と突き合わせるのはここ。スタブの分は入れない（額 0 だが意味が違う）。
    totalUsd: measured.totalUsd + otherUsd,
  }
}
