import { describe, expect, it } from 'vitest'
import { brandReviewer } from '../brand.js'
import { makeFrame, makeMeasurements, makeShot, snapshot } from './fixtures.js'

const YELLOW = 'ixa_yellow'
const REQUIREMENT = { key: YELLOW, minRatio: 0.05, maxRatio: 0.4 }

const framesWithYellow = (ratios: readonly number[]) =>
  ratios.map((ratio, index) => makeFrame(index, 0.5, { [YELLOW]: ratio }))

describe('brandReviewer', () => {
  it('ブランド色の要求が無ければ指摘を返さない（skip）', () => {
    const findings = brandReviewer(
      makeMeasurements({ brandColors: [], frames: framesWithYellow([0, 0, 0, 0]) }),
    )
    expect(findings).toEqual([])
  })

  it('フレームが無ければ指摘を返さない（technical が fail を出すため二重に出さない）', () => {
    const findings = brandReviewer(makeMeasurements({ brandColors: [REQUIREMENT], frames: [] }))
    expect(findings).toEqual([])
  })

  it('占有率が範囲内なら指摘を返さない', () => {
    const findings = brandReviewer(
      makeMeasurements({ brandColors: [REQUIREMENT], frames: framesWithYellow([0.1, 0.2, 0.15]) }),
    )
    expect(findings).toEqual([])
  })

  it('下限ちょうどは指摘しない（境界値）', () => {
    const findings = brandReviewer(
      makeMeasurements({ brandColors: [REQUIREMENT], frames: framesWithYellow([0.05, 0.05]) }),
    )
    expect(findings).toEqual([])
  })

  it('占有率が足りなければ warn を返し、最も少ないフレームを指す', () => {
    const findings = brandReviewer(
      makeMeasurements({ brandColors: [REQUIREMENT], frames: framesWithYellow([0.03, 0.01, 0.02]) }),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('warn')
    expect(findings[0]?.score).toBeCloseTo(0.4, 10)
    expect(findings[0]?.evidence?.frameSec).toBe(1)
    // 再生成ループがそのままプロンプトへ足せる断片を返す。
    expect(findings[0]?.suggestedPromptDelta).toBe(`color palette: ${YELLOW}`)
  })

  it('色が画面に無ければ fail', () => {
    const findings = brandReviewer(
      makeMeasurements({ brandColors: [REQUIREMENT], frames: framesWithYellow([0, 0, 0]) }),
    )

    expect(findings[0]?.severity).toBe('fail')
    expect(findings[0]?.score).toBe(0)
    expect(findings[0]?.message).toContain('画面に無い')
  })

  it('colorRatios にキーが無ければ写っていないものとして扱う', () => {
    const frames = [makeFrame(0, 0.5, { other: 0.9 }), makeFrame(1, 0.5, {})]
    const findings = brandReviewer(makeMeasurements({ brandColors: [REQUIREMENT], frames }))

    expect(findings[0]?.severity).toBe('fail')
  })

  it('上限を超えていれば warn を返し、プロンプト差分は返さない', () => {
    const findings = brandReviewer(
      makeMeasurements({ brandColors: [REQUIREMENT], frames: framesWithYellow([0.5, 0.9, 0.7]) }),
    )

    expect(findings[0]?.severity).toBe('warn')
    expect(findings[0]?.evidence?.frameSec).toBe(1)
    expect(findings[0]?.score).toBeCloseTo(0.4 / 0.7, 10)
    // 「減らす」はプロンプトの追記で表現できないので null。
    expect(findings[0]?.suggestedPromptDelta).toBeNull()
  })

  it('のりしろのフレームは判定に入れない', () => {
    const frames = [
      makeFrame(0, 0.5, { [YELLOW]: 0 }),
      makeFrame(1, 0.5, { [YELLOW]: 0.2 }),
      makeFrame(2, 0.5, { [YELLOW]: 0.2 }),
    ]
    const findings = brandReviewer(
      makeMeasurements({
        brandColors: [REQUIREMENT],
        frames,
        shot: makeShot({ sourceInSec: 0.5, durationSec: 3 }),
      }),
    )
    expect(findings).toEqual([])
  })

  it('使う区間にフレームが 1 枚も無ければ全フレームで判定する', () => {
    const frames = [makeFrame(0, 0.5, { [YELLOW]: 0.2 })]
    const findings = brandReviewer(
      makeMeasurements({
        brandColors: [REQUIREMENT],
        frames,
        shot: makeShot({ sourceInSec: 2, durationSec: 1 }),
      }),
    )
    expect(findings).toEqual([])
  })

  it('要求ごとに指摘を返す', () => {
    const frames = [makeFrame(0, 0.5, { [YELLOW]: 0, navy: 0.9 })]
    const findings = brandReviewer(
      makeMeasurements({
        brandColors: [REQUIREMENT, { key: 'navy', minRatio: 0.05, maxRatio: 0.3 }],
        frames,
      }),
    )

    expect(findings.map((f) => f.severity)).toEqual(['fail', 'warn'])
  })

  it('min > max の要求は握り潰さず RangeError を投げる', () => {
    expect(() =>
      brandReviewer(
        makeMeasurements({
          brandColors: [{ key: YELLOW, minRatio: 0.5, maxRatio: 0.1 }],
          frames: framesWithYellow([0.2]),
        }),
      ),
    ).toThrow(RangeError)
  })

  it('入力を破壊的に変更しない', () => {
    const measurements = makeMeasurements({
      brandColors: [REQUIREMENT],
      frames: framesWithYellow([0.01, 0.02]),
    })
    const before = snapshot(measurements)
    brandReviewer(measurements)
    expect(snapshot(measurements)).toBe(before)
  })
})

describe('brandReviewer の要求検証', () => {
  it('0..1 の外にある要求は RangeError を投げる', () => {
    expect(() =>
      brandReviewer(
        makeMeasurements({
          brandColors: [{ key: YELLOW, minRatio: 0.1, maxRatio: 1.5 }],
          frames: framesWithYellow([0.2]),
        }),
      ),
    ).toThrow(RangeError)
  })
})
