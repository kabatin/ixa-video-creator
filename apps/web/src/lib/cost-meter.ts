import type { WireCostMeter } from '@/lib/cost-meter-api'

/**
 * 費用メーターの表示ロジック（P63-2）。**判定はここだけが持つ。**
 *
 * この画面でいちばん間違えやすいのは「$0 だから安全」と読ませてしまうことだ。
 * 本制作の Take 50 件はすべてスタブで、スタブの単価は 0 である。
 * 額だけを出すと「$0 / $300 使用、余裕あり」と読めるが、実際には実 Provider を一度も回していない。
 * **だから額と出どころ（実測かスタブか）を必ず同じ画面に並べる。**
 */

/** 予算に対する割合がここを超えたら注意。 */
export const WARN_RATIO = 0.8
/** ここを超えたら超過。 */
export const DANGER_RATIO = 1

/** 色は役割の名前で持つ（PHASE 5.9）。素の色名は部品に書かない。 */
export type CostTone = 'ok' | 'warn' | 'danger'

export type CostMeterView = {
  /** 予算。未設定なら金額ではなく「未設定」と出す。0 に畳まない（L-021）。 */
  readonly budgetLabel: string
  readonly budgetIsSet: boolean
  /** 実 Provider で実際に払った額。 */
  readonly measuredLabel: string
  /** 予算に対する割合（0〜1 で頭打ち）。バーを描けないときは null。 */
  /** Take 以外で払った額の内訳。1 件も無ければ null。 */
  readonly otherRunsNote: string | null
  readonly ratio: number | null
  readonly ratioLabel: string | null
  readonly tone: CostTone
  /** **額の出どころ。額と必ず一緒に出す。** */
  readonly provenance: string
  /** 実測が 1 件も無い状態。額に意味が無いことを画面が強調するために使う。 */
  /** 実測の Take が 1 件も無い。Provider の名前を添える判断に使う。 */
  readonly measuredIsEmpty: boolean
  /**
   * **額そのものに意味が無い**（実測の Take も Take 以外の実行費も 0）。
   * 下書きやレビューで実際に払っていれば、Take が 0 件でも額には意味がある。
   */
  readonly spendIsEmpty: boolean
  /**
   * **実測として数えた Provider の名前。** 額の隣に必ず出す。
   *
   * スタブの一覧に載せ忘れた Provider は額 0 のまま実測に数えられる。
   * 「実測 $0.00」だけでは何も起きていないように見えるが、
   * 「実測 $0.00（stub-v2 が 40 件）」なら載せ忘れだと分かる。
   */
  readonly measuredProviders: string
  /** 消えた Shot の分。**差がある事実を黙って捨てない**（L-015）。無ければ null。 */
  readonly unlistedNote: string | null
}

const money = (usd: number): string => `$${usd.toFixed(2)}`

const percent = (ratio: number): string => `${Math.round(ratio * 100).toString()}%`

/**
 * 出どころの 1 行を作る。**実測が 0 件なら必ずそう書く。**
 * 予算が入っていても省略しない。省略した瞬間に額が独り歩きする。
 */
const describeProvenance = (meter: WireCostMeter): string => {
  const measured = meter.measured.takeCount
  const stub = meter.stub.takeCount

  if (measured === 0 && stub === 0) return 'まだ 1 件も生成していません'
  if (measured === 0) return `実測 0 件（スタブ ${stub.toString()} 件）`
  if (stub === 0) return `実測 ${measured.toString()} 件`
  return `実測 ${measured.toString()} 件・スタブ ${stub.toString()} 件`
}

/**
 * 割合を出す。予算が未設定、または予算 0 のときはバーを描かない。
 *
 * 予算 0 で割ると Infinity になり、バーが意味を失う。
 * 「予算 0 なのに払っている」は割合ではなく色（danger）で伝える。
 */
const computeRatio = (budgetUsd: number | null, spentUsd: number): number | null => {
  if (budgetUsd === null || budgetUsd <= 0) return null
  return Math.min(spentUsd / budgetUsd, 1)
}

const computeTone = (budgetUsd: number | null, spentUsd: number): CostTone => {
  if (budgetUsd === null) return 'ok'
  if (budgetUsd <= 0) return spentUsd > 0 ? 'danger' : 'ok'

  const raw = spentUsd / budgetUsd
  if (raw >= DANGER_RATIO) return 'danger'
  if (raw >= WARN_RATIO) return 'warn'
  return 'ok'
}

/**
 * 符号のままでは読めない Provider の名前。**知らない Provider は符号のまま出す**（載せ忘れに気付くため）。
 * 持ち込んだ Take の $0 は「無料」ではなく「アプリの外で払った」（ADR-0026）。
 */
const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  import: '持ち込み（費用はアプリの外）',
}

/**
 * 実測として数えた Provider を名前で並べる。
 * 1 件も無ければ「該当 Provider なし」。**空欄にしない。**
 */
const describeMeasuredProviders = (meter: WireCostMeter): string =>
  meter.measured.byProvider.length === 0
    ? '該当 Provider なし'
    : meter.measured.byProvider
        .map((p) => `${PROVIDER_LABELS[p.providerId] ?? p.providerId} ${p.takeCount.toString()} 件`)
        .join('・')

/**
 * 内訳に出せなかった分の説明。
 * Shot ごとの行を足し算しても合計に届かない理由を、画面の言葉で持たせる。
 */
const describeUnlisted = (meter: WireCostMeter): string | null => {
  const { takeCount, measuredUsd } = meter.unlistedShots
  if (takeCount === 0) return null
  return `削除された Shot の分 ${money(measuredUsd)}（${takeCount.toString()} 件）を含みます`
}

/** 種類ごとの言葉。**符号は API が持ち、言葉はここが持つ。** */
const RUN_KIND_LABELS: Readonly<Record<string, string>> = {
  storyboard_draft: '絵コンテ下書き',
  review: 'レビュー',
}

/**
 * Take 以外で払った額の説明。**知らない種類でも名前を出す**（黙って消さない）。
 * 1 件も無ければ null。
 */
const describeOtherRuns = (meter: WireCostMeter): string | null =>
  meter.otherRuns.length === 0
    ? null
    : `うち Take 以外: ${meter.otherRuns
        .map(
          (run) =>
            `${RUN_KIND_LABELS[run.kind] ?? run.kind} ${money(run.totalUsd)}（${String(run.runCount)} 回）`,
        )
        .join(' / ')}`

/**
 * wire の費用メーターを画面の言葉へ写す。
 *
 * **予算の判定に使うのは `totalUsd`。** 実測の Take だけを見ていたため、
 * 絵コンテ下書きで実際に $0.38 を払ってもメーターは $0.00 のままだった
 * （2026-09-18）。生成だけが金を使うわけではない。
 * スタブの額（常に 0）は混ぜない。実 Provider へ切り替えたとき意味が変わるため。
 */
export const buildCostMeterView = (meter: WireCostMeter): CostMeterView => {
  const spentUsd = meter.totalUsd
  const ratio = computeRatio(meter.budgetUsd, spentUsd)

  return {
    budgetLabel: meter.budgetUsd === null ? '予算未設定' : money(meter.budgetUsd),
    budgetIsSet: meter.budgetUsd !== null,
    measuredLabel: money(spentUsd),
    ratio,
    ratioLabel: ratio === null ? null : percent(ratio),
    tone: computeTone(meter.budgetUsd, spentUsd),
    provenance: describeProvenance(meter),
    measuredIsEmpty: meter.measured.takeCount === 0,
    // **合計で見る。** Take が 0 件でも下書きで払っていれば額には意味がある。
    spendIsEmpty: meter.totalUsd === 0,
    measuredProviders: describeMeasuredProviders(meter),
    unlistedNote: describeUnlisted(meter),
    otherRunsNote: describeOtherRuns(meter),
  }
}
