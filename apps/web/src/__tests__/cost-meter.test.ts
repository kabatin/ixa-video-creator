import { describe, expect, it } from 'vitest'
import { buildCostMeterView } from '@/lib/cost-meter'
import type { WireCostMeter } from '@/lib/cost-meter-api'

/**
 * 費用メーターの表示ロジック（P63-2）。
 *
 * ここで守りたいのは 1 点だけ。**額を出どころから切り離さない。**
 */

/** 実測のバケツ。既定では Provider の内訳を持たない（実 Provider を回していない状態）。 */
const measuredOf = (
  takeCount: number,
  totalUsd: number,
  byProvider: readonly { providerId: string; takeCount: number; totalUsd: number }[] = [],
): WireCostMeter['measured'] => ({ takeCount, totalUsd, byProvider: [...byProvider] })

const meter = (o: Partial<WireCostMeter> = {}): WireCostMeter => ({
  budgetUsd: 300,
  measured: measuredOf(0, 0),
  stub: { takeCount: 0, totalUsd: 0 },
  byShot: [],
  unlistedShots: { takeCount: 0, measuredUsd: 0, stubTakeCount: 0 },
  otherRuns: [],
  copied: { takeCount: 0, totalUsd: 0 },
  ...o,
  /**
   * **既定は「実測 + Take 以外」の合計。** 個別に上書きもできる。
   * ここを 0 固定にすると、`measured` を足したテストが予算バーを動かさなくなり、
   * 何を確かめているのか分からなくなる。
   */
  totalUsd:
    o.totalUsd ??
    (o.measured ?? measuredOf(0, 0)).totalUsd +
      (o.otherRuns ?? []).reduce((total, run) => total + run.totalUsd, 0),
})

describe('buildCostMeterView', () => {
  /** **本制作そのものの状態。** ここが崩れると画面が嘘をつく。 */
  it('実測 0 件・スタブ 50 件なら、予算があっても実測 0 件と言い切る', () => {
    const view = buildCostMeterView(
      meter({ budgetUsd: 300, stub: { takeCount: 50, totalUsd: 0 } }),
    )

    expect(view.provenance).toBe('実測 0 件（スタブ 50 件）')
    expect(view.measuredIsEmpty).toBe(true)
    expect(view.measuredLabel).toBe('$0.00')
    expect(view.budgetLabel).toBe('$300.00')
  })

  it('1 件も生成していない状態と、スタブだけの状態を別の文にする', () => {
    expect(buildCostMeterView(meter()).provenance).toBe('まだ 1 件も生成していません')
    expect(buildCostMeterView(meter({ stub: { takeCount: 3, totalUsd: 0 } })).provenance).toBe(
      '実測 0 件（スタブ 3 件）',
    )
  })

  it('実測とスタブが両方あれば両方の件数を出す', () => {
    const view = buildCostMeterView(
      meter({
        measured: measuredOf(4, 6),
        stub: { takeCount: 50, totalUsd: 0 },
      }),
    )
    expect(view.provenance).toBe('実測 4 件・スタブ 50 件')
    expect(view.measuredIsEmpty).toBe(false)
  })

  /**
   * 持ち込みの Take は API では実測に数えられる（額は 0）。そのまま「実測 58 件」と出すと、
   * 58 本を生成して $0 だったと読める。**持ち込みは別に数える**（ADR-0026）。
   */
  it('持ち込みは実測から外し、持ち込みとして数える', () => {
    const imported = (count: number, extra: readonly { providerId: string; takeCount: number; totalUsd: number }[] = []) =>
      measuredOf(count + extra.reduce((sum, p) => sum + p.takeCount, 0), 0, [
        { providerId: 'import', takeCount: count, totalUsd: 0 },
        ...extra,
      ])

    expect(buildCostMeterView(meter({ measured: imported(58) })).provenance).toBe('実測 0 件（持ち込み 58 件）')
    expect(
      buildCostMeterView(meter({ measured: imported(2), stub: { takeCount: 3, totalUsd: 0 } })).provenance,
    ).toBe('実測 0 件（スタブ 3 件・持ち込み 2 件）')
    expect(
      buildCostMeterView(meter({ measured: imported(2, [{ providerId: 'byteplus', takeCount: 4, totalUsd: 0 }]) }))
        .provenance,
    ).toBe('実測 4 件・持ち込み 2 件')
  })

  it('スタブが無ければスタブの件数を書かない', () => {
    const view = buildCostMeterView(meter({ measured: measuredOf(2, 3) }))
    expect(view.provenance).toBe('実測 2 件')
  })

  /** **null は「未設定」。$0 と書いたら予算ゼロと区別が付かない**（L-021）。 */
  it('予算が未設定ならバーを描かず、金額も出さない', () => {
    const view = buildCostMeterView(meter({ budgetUsd: null, measured: measuredOf(1, 9) }))

    expect(view.budgetLabel).toBe('予算未設定')
    expect(view.budgetIsSet).toBe(false)
    expect(view.ratio).toBeNull()
    expect(view.ratioLabel).toBeNull()
    expect(view.tone).toBe('ok')
  })

  it('予算 0 で払っていれば超過として出す（バーは描かない）', () => {
    const view = buildCostMeterView(meter({ budgetUsd: 0, measured: measuredOf(1, 0.5) }))

    expect(view.budgetLabel).toBe('$0.00')
    expect(view.budgetIsSet).toBe(true)
    expect(view.ratio).toBeNull()
    expect(view.tone).toBe('danger')
  })

  it('予算 0 で 1 円も払っていなければ超過にしない', () => {
    expect(buildCostMeterView(meter({ budgetUsd: 0 })).tone).toBe('ok')
  })

  it('割合と色を実測だけから決める', () => {
    const cases: readonly (readonly [number, string, number])[] = [
      [0, 'ok', 0],
      [150, 'ok', 0.5],
      [240, 'warn', 0.8],
      [299, 'warn', 0.9966666666666667],
      [300, 'danger', 1],
    ]

    for (const [spent, tone, ratio] of cases) {
      const view = buildCostMeterView(
        meter({ budgetUsd: 300, measured: measuredOf(1, spent) }),
      )
      expect(view.tone, `${spent.toString()} で ${tone}`).toBe(tone)
      expect(view.ratio).toBeCloseTo(ratio, 10)
    }
  })

  /** スタブの額（常に 0）を混ぜると、実 Provider へ切り替えたとき意味が変わる。 */
  it('スタブの件数は割合を動かさない', () => {
    const view = buildCostMeterView(
      meter({
        budgetUsd: 300,
        measured: measuredOf(1, 150),
        stub: { takeCount: 50, totalUsd: 0 },
      }),
    )
    expect(view.ratio).toBeCloseTo(0.5, 10)
  })

  it('予算を超えてもバーは 100% で頭打ちにする', () => {
    const view = buildCostMeterView(
      meter({ budgetUsd: 300, measured: measuredOf(9, 450) }),
    )
    expect(view.ratio).toBe(1)
    expect(view.ratioLabel).toBe('100%')
    expect(view.tone).toBe('danger')
  })
})

describe('実測した Provider の名前', () => {
  it('1 件も無ければ「該当 Provider なし」と出す（空欄にしない）', () => {
    const view = buildCostMeterView(meter({ stub: { takeCount: 50, totalUsd: 0 } }))
    expect(view.measuredProviders).toBe('該当 Provider なし')
  })

  /**
   * **一覧への載せ忘れは額では気付けない。** 額は $0 のままなので、名前だけが手がかりになる。
   */
  it('実測に数えた Provider を名前と件数で並べる', () => {
    const view = buildCostMeterView(
      meter({
        measured: measuredOf(41, 12.3, [
          { providerId: 'byteplus', takeCount: 1, totalUsd: 12.3 },
          { providerId: 'stub-v2', takeCount: 40, totalUsd: 0 },
        ]),
      }),
    )

    expect(view.measuredProviders).toBe('byteplus 1 件・stub-v2 40 件')
  })

  /** 持ち込んだ Take の $0 は「無料」ではなく「アプリの外で払った」（ADR-0026）。 */
  it('持ち込みは Provider の符号でなく、費用がアプリの外だと言う', () => {
    const view = buildCostMeterView(
      meter({ measured: measuredOf(60, 0, [{ providerId: 'import', takeCount: 60, totalUsd: 0 }]) }),
    )

    expect(view.measuredProviders).toBe('持ち込み（費用はアプリの外） 60 件')
  })
})

describe('内訳に出せなかった分', () => {
  it('消えた Shot の分があれば額と件数で説明する', () => {
    const view = buildCostMeterView(
      meter({
        measured: measuredOf(3, 10),
        unlistedShots: { takeCount: 2, measuredUsd: 4, stubTakeCount: 0 },
      }),
    )

    expect(view.unlistedNote).toBe('削除された Shot の分 $4.00（2 件）を含みます')
  })

  it('溢れが無ければ余計な但し書きを出さない', () => {
    expect(buildCostMeterView(meter()).unlistedNote).toBeNull()
  })
})

/**
 * **生成だけが金を使うわけではない。**
 * 実際に絵コンテ下書きを 1 回回して $0.38 を払ったのに、
 * 予算バーが実測の Take だけを見ていたため $0.00 のままだった（2026-09-18）。
 */
describe('Take 以外で払った額', () => {
  it('予算の使用率に含める', () => {
    const view = buildCostMeterView(
      meter({
        budgetUsd: 100,
        otherRuns: [{ kind: 'storyboard_draft', runCount: 1, totalUsd: 25 }],
      }),
    )

    expect(view.ratioLabel).toBe('25%')
  })

  it('種類ごとに名前と件数を出す', () => {
    const view = buildCostMeterView(
      meter({
        otherRuns: [
          { kind: 'storyboard_draft', runCount: 2, totalUsd: 0.5 },
          { kind: 'review', runCount: 3, totalUsd: 1.5 },
        ],
      }),
    )

    expect(view.otherRunsNote).toContain('絵コンテ下書き')
    expect(view.otherRunsNote).toContain('2 回')
    expect(view.otherRunsNote).toContain('レビュー')
  })

  it('声と文字起こし（ナレーション）も名前で出す', () => {
    const view = buildCostMeterView(
      meter({
        otherRuns: [
          { kind: 'voice', runCount: 4, totalUsd: 0.31 },
          { kind: 'transcribe', runCount: 1, totalUsd: 0.05 },
        ],
      }),
    )

    expect(view.otherRunsNote).toContain('声')
    expect(view.otherRunsNote).toContain('文字起こし')
    expect(view.otherRunsNote).not.toContain('transcribe')
  })

  /** 知らない種類でも黙って消さない。符号のまま出す方が、消えるよりよい。 */
  it('知らない種類は符号のまま出す', () => {
    const view = buildCostMeterView(
      meter({ otherRuns: [{ kind: 'unknown_kind', runCount: 1, totalUsd: 2 }] }),
    )

    expect(view.otherRunsNote).toContain('unknown_kind')
  })

  it('1 度も回していなければ何も言わない', () => {
    expect(buildCostMeterView(meter()).otherRunsNote).toBeNull()
  })
})

/** 作品の複製で写した Take（制作者 2026-10-04「プロジェクトを複製」）。この作品の費用には入れず、別に言う。 */
describe('buildCostMeterView: 複製した Take', () => {
  it('件数と元の額を言い、この作品の費用には入れていないと添える', () => {
    const view = buildCostMeterView(meter({ copied: { takeCount: 38, totalUsd: 0 } }))

    expect(view.copiedNote).toBe('複製した Take 38 件は元の作品で作ったもの（$0.00）で、この作品の費用には入れていません')
  })

  it('複製した Take が無ければ何も言わない', () => {
    expect(buildCostMeterView(meter()).copiedNote).toBeNull()
  })
})
