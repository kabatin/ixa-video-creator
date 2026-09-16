import { describe, expect, it } from 'vitest'
import { PROGRESS_INTERVAL_MS, PROGRESS_STEP, createProgressReporter } from '../progress.js'

/** 進捗の間引き規則の検証。時計はテストから差し替える。 */

const collect = (now: () => number) => {
  const reported: number[] = []
  const report = createProgressReporter({ onReport: (p) => reported.push(p), now })
  return { reported, report }
}

describe('createProgressReporter', () => {
  it('1% 進むまでは 1 回も報告しない', () => {
    const { reported, report } = collect(() => 0)

    // 100 フレームで合計 1% しか進まない長尺のレンダリングを模す。
    for (let i = 1; i <= 100; i += 1) report(i * 0.0001)

    expect(reported).toHaveLength(1)
    expect(reported[0]).toBeCloseTo(PROGRESS_STEP, 10)
  })

  it('進みが遅くても 2 秒経てば報告する', () => {
    let clock = 0
    const { reported, report } = collect(() => clock)

    report(0.001)
    expect(reported).toHaveLength(0)

    clock += PROGRESS_INTERVAL_MS
    report(0.002)

    expect(reported).toEqual([0.002])
  })

  it('完了（1）は刻みに満たなくても必ず報告する', () => {
    const { reported, report } = collect(() => 0)

    report(0.999)
    report(1)

    expect(reported).toEqual([0.999, 1])
  })

  it('同じ値を繰り返し呼ばれても増やさない', () => {
    const { reported, report } = collect(() => 0)

    report(1)
    report(1)
    report(1)

    expect(reported).toEqual([1])
  })

  it('巻き戻る値は報告しない', () => {
    const { reported, report } = collect(() => 0)

    report(0.5)
    report(0.2)
    report(0.51)

    expect(reported).not.toContain(0.2)
    expect(reported).toEqual([...reported].sort((a, b) => a - b))
  })

  it('範囲外の値は 0..1 に丸める', () => {
    const { reported, report } = collect(() => 0)

    report(-1)
    report(2)

    expect(reported).toEqual([1])
  })

  it('1% 刻みで進むならほぼ毎回報告する（間引きすぎない）', () => {
    const { reported, report } = collect(() => 0)

    for (let i = 1; i <= 100; i += 1) report(i / 100)

    // i/100 の float 誤差で差が 0.01 をわずかに下回る回があるため 100 にはならない。
    expect(reported.length).toBeGreaterThan(80)
    expect(reported.at(-1)).toBe(1)
  })
})
