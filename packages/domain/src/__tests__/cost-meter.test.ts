import { describe, expect, it } from 'vitest'
import { ShotId, newId } from '../common/ids.js'
import { buildCostMeter, type CostMeterTake } from '../generation/cost-meter.js'

const shotA = newId(ShotId)
const shotB = newId(ShotId)

const take = (o: Partial<CostMeterTake> = {}): CostMeterTake => ({
  shotId: shotA,
  costUsd: 1.5,
  providerId: 'fal',
  ...o,
})

describe('buildCostMeter', () => {
  it('Take が 1 件も無ければ両方のバケツが空になる', () => {
    const meter = buildCostMeter({ budgetUsd: 300, takes: [], stubProviderIds: ['stub'], listedShotIds: null })

    expect(meter.measured).toEqual({ takeCount: 0, totalUsd: 0, byProvider: [] })
    expect(meter.stub).toEqual({ takeCount: 0, totalUsd: 0 })
    expect(meter.byShot.size).toBe(0)
  })

  it('スタブの Take は件数だけ数え、実測には入れない', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [
        take({ providerId: 'stub', costUsd: 0 }),
        take({ providerId: 'stub', costUsd: 0, shotId: shotB }),
      ],
      stubProviderIds: ['stub'],
      listedShotIds: null,
    })

    expect(meter.stub).toEqual({ takeCount: 2, totalUsd: 0 })
    expect(meter.measured.takeCount).toBe(0)
  })

  /**
   * **この 1 件が「額ではなく素性で振り分けている」ことの証明。**
   * 実 Provider が 0 ドルを返すことはある（無料枠・失敗後の返金など）。
   * それを「スタブ」に寄せると、実際には実 API を回したのに回していないように見える。
   */
  it('実 Provider の $0 は「実測 $0」であってスタブではない', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [take({ providerId: 'fal', costUsd: 0 })],
      stubProviderIds: ['stub'],
      listedShotIds: null,
    })

    expect(meter.measured.takeCount).toBe(1)
    expect(meter.measured.totalUsd).toBe(0)
    expect(meter.stub.takeCount).toBe(0)
  })

  it('実 Provider の額を合算する', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [take({ costUsd: 1.5 }), take({ costUsd: 2.25 }), take({ providerId: 'stub', costUsd: 0 })],
      stubProviderIds: ['stub'],
      listedShotIds: null,
    })

    expect(meter.measured.takeCount).toBe(2)
    expect(meter.measured.totalUsd).toBeCloseTo(3.75, 10)
    expect(meter.stub.takeCount).toBe(1)
  })

  it('Shot ごとに実測とスタブを別々に持つ', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [
        take({ shotId: shotA, costUsd: 1.5 }),
        take({ shotId: shotA, providerId: 'stub', costUsd: 0 }),
        take({ shotId: shotB, providerId: 'stub', costUsd: 0 }),
      ],
      stubProviderIds: ['stub'],
      listedShotIds: null,
    })

    expect(meter.byShot.get(shotA)).toEqual({ measuredUsd: 1.5, stubTakeCount: 1 })
    expect(meter.byShot.get(shotB)).toEqual({ measuredUsd: 0, stubTakeCount: 1 })
    expect(meter.byShot.size).toBe(2)
  })

  it('スタブ Provider が複数あってもすべてスタブとして数える', () => {
    const meter = buildCostMeter({
      budgetUsd: null,
      takes: [take({ providerId: 'stub', costUsd: 0 }), take({ providerId: 'stub-image', costUsd: 0 })],
      stubProviderIds: ['stub', 'stub-image'],
      listedShotIds: null,
    })

    expect(meter.stub.takeCount).toBe(2)
    expect(meter.measured.takeCount).toBe(0)
  })

  it('スタブの一覧が空なら、すべて実測として数える', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [take({ providerId: 'stub', costUsd: 0 })],
      stubProviderIds: [],
      listedShotIds: null,
    })

    expect(meter.measured.takeCount).toBe(1)
    expect(meter.stub.takeCount).toBe(0)
  })

  /** **null は「未設定」。0 に丸めない**（L-021）。 */
  it('予算が未設定なら null のまま返す', () => {
    const meter = buildCostMeter({ budgetUsd: null, takes: [], stubProviderIds: ['stub'], listedShotIds: null })
    expect(meter.budgetUsd).toBeNull()
  })

  it('予算 0 は未設定ではなく 0 として返す', () => {
    const meter = buildCostMeter({ budgetUsd: 0, takes: [], stubProviderIds: ['stub'], listedShotIds: null })
    expect(meter.budgetUsd).toBe(0)
  })

  it('入力の配列を破壊的に変更しない', () => {
    const takes = [take({ costUsd: 1.5 })]
    const snapshot = structuredClone(takes)
    buildCostMeter({ budgetUsd: 300, takes, stubProviderIds: ['stub'], listedShotIds: null })
    expect(takes).toEqual(snapshot)
  })
})

describe('buildCostMeter の Provider 名', () => {
  /**
   * **一覧への載せ忘れは額では気付けない。** スタブの額は 0 なので「実測 $0.00」としか出ない。
   * 名前を出せば「知らない Provider が 40 件」と読める。これがこの内訳の存在理由。
   */
  it('一覧に無い ID は実測に入り、その名前が内訳に出る', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [
        take({ providerId: 'stub-v2', costUsd: 0 }),
        take({ providerId: 'stub-v2', costUsd: 0 }),
      ],
      stubProviderIds: ['stub'],
      listedShotIds: null,
    })

    expect(meter.measured.takeCount).toBe(2)
    expect(meter.measured.byProvider).toEqual([
      { providerId: 'stub-v2', takeCount: 2, totalUsd: 0 },
    ])
  })

  it('スタブとして数えた Provider は内訳に出さない', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [take({ providerId: 'stub', costUsd: 0 })],
      stubProviderIds: ['stub'],
      listedShotIds: null,
    })

    expect(meter.measured.byProvider).toEqual([])
  })

  it('Provider ごとに件数と額を分け、名前の昇順で並べる', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [
        take({ providerId: 'fal', costUsd: 1.5 }),
        take({ providerId: 'byteplus', costUsd: 2 }),
        take({ providerId: 'fal', costUsd: 0.5 }),
      ],
      stubProviderIds: ['stub'],
      listedShotIds: null,
    })

    expect(meter.measured.byProvider).toEqual([
      { providerId: 'byteplus', takeCount: 1, totalUsd: 2 },
      { providerId: 'fal', takeCount: 2, totalUsd: 2 },
    ])
  })
})

describe('buildCostMeter の行に出せない Shot', () => {
  /** 払った額は Shot を消しても戻らない。合計からは落とさない。 */
  it('一覧に無い Shot の Take は合計に入れ、内訳からは外す', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [take({ shotId: shotA, costUsd: 1.5 }), take({ shotId: shotB, costUsd: 4 })],
      stubProviderIds: ['stub'],
      listedShotIds: [shotA],
    })

    expect(meter.measured.totalUsd).toBeCloseTo(5.5, 10)
    expect([...meter.byShot.keys()]).toEqual([shotA])
    expect(meter.unlistedShots).toEqual({ takeCount: 1, measuredUsd: 4, stubTakeCount: 0 })
  })

  /** ズレを黙って捨てない。内訳を足した人が合計と合わずに困る（L-015）。 */
  it('内訳の合計と全体の合計の差が unlistedShots で説明できる', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [
        take({ shotId: shotA, costUsd: 1 }),
        take({ shotId: shotB, costUsd: 2 }),
        take({ shotId: shotB, providerId: 'stub', costUsd: 0 }),
      ],
      stubProviderIds: ['stub'],
      listedShotIds: [shotA],
    })

    const listedMeasured = [...meter.byShot.values()].reduce((sum, c) => sum + c.measuredUsd, 0)
    expect(listedMeasured + meter.unlistedShots.measuredUsd).toBeCloseTo(
      meter.measured.totalUsd,
      10,
    )
    expect(meter.unlistedShots.takeCount).toBe(2)
  })

  it('一覧が空なら、すべての Take が行に出せない扱いになる', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [take({ shotId: shotA, costUsd: 1 })],
      stubProviderIds: ['stub'],
      listedShotIds: [],
    })

    expect(meter.byShot.size).toBe(0)
    expect(meter.unlistedShots.takeCount).toBe(1)
    expect(meter.measured.totalUsd).toBe(1)
  })

  /** null は「絞らない」。空の一覧（= 生きている Shot が 1 件も無い）と混ぜない。 */
  it('一覧が null なら 1 件も溢れない', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [take({ shotId: shotA, costUsd: 1 })],
      stubProviderIds: ['stub'],
      listedShotIds: null,
    })

    expect(meter.byShot.size).toBe(1)
    expect(meter.unlistedShots).toEqual({ takeCount: 0, measuredUsd: 0, stubTakeCount: 0 })
  })
})

describe('Shot ごとの内訳の単位', () => {
  /**
   * **スタブの額は常に 0 なので、額で持つと欄が何も語らない。**
   * 件数なら「この Shot を何回焼いたか」が読める。
   */
  it('スタブは件数で数え、実測は額で数える', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [
        take({ shotId: shotA, providerId: 'stub', costUsd: 0 }),
        take({ shotId: shotA, providerId: 'stub', costUsd: 0 }),
        take({ shotId: shotA, providerId: 'stub', costUsd: 0 }),
        take({ shotId: shotA, providerId: 'fal', costUsd: 2.5 }),
      ],
      stubProviderIds: ['stub'],
      listedShotIds: null,
    })

    expect(meter.byShot.get(shotA)).toEqual({ measuredUsd: 2.5, stubTakeCount: 3 })
  })

  /** スタブが額を返しても、件数として数える（額に寄せない）。 */
  it('スタブが 0 でない額を返しても件数で数える', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [take({ shotId: shotA, providerId: 'stub', costUsd: 9 })],
      stubProviderIds: ['stub'],
      listedShotIds: null,
    })

    expect(meter.byShot.get(shotA)).toEqual({ measuredUsd: 0, stubTakeCount: 1 })
    // 全体の合計は額のまま。件数に化けない。
    expect(meter.stub).toEqual({ takeCount: 1, totalUsd: 9 })
  })
})

describe('溢れた分の単位', () => {
  /**
   * **`takeCount` だけでは内訳が引けない。** 実測とスタブが混ざったとき、
   * 5 件のうち何件がスタブかは額 0 からは分からない。件数なら引ける。
   */
  it('溢れた分の実測とスタブを、額と件数で別々に持つ', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [
        take({ shotId: shotB, providerId: 'fal', costUsd: 3 }),
        take({ shotId: shotB, providerId: 'stub', costUsd: 0 }),
        take({ shotId: shotB, providerId: 'stub', costUsd: 0 }),
      ],
      stubProviderIds: ['stub'],
      listedShotIds: [shotA],
    })

    expect(meter.unlistedShots).toEqual({ takeCount: 3, measuredUsd: 3, stubTakeCount: 2 })
    // 全件からスタブを引けば実測の件数が出る。
    expect(meter.unlistedShots.takeCount - meter.unlistedShots.stubTakeCount).toBe(1)
  })

  it('スタブが 0 でない額を返しても、溢れた分は件数で数える', () => {
    const meter = buildCostMeter({
      budgetUsd: 300,
      takes: [take({ shotId: shotB, providerId: 'stub', costUsd: 7 })],
      stubProviderIds: ['stub'],
      listedShotIds: [shotA],
    })

    expect(meter.unlistedShots.stubTakeCount).toBe(1)
    expect(meter.stub.totalUsd).toBe(7)
  })
})
