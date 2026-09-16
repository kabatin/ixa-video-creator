import { describe, expect, it } from 'vitest'
import { musicReviewer } from '../music.js'
import { makeMeasurements, makeMusicAnalysis, makeShot, snapshot } from './fixtures.js'

const severities = (findings: readonly { severity: string }[]): string[] =>
  findings.map((f) => f.severity)

describe('musicReviewer', () => {
  it('楽曲解析が無ければ指摘を返さない（skip）', () => {
    const findings = musicReviewer(
      makeMeasurements({ musicAnalysis: null, shot: makeShot({ startSec: 0.3 }) }),
    )
    expect(findings).toEqual([])
  })

  it('ビートが 2 点未満ならグリッドを作れないので判定しない', () => {
    const findings = musicReviewer(
      makeMeasurements({
        musicAnalysis: makeMusicAnalysis({ beats: [0] }),
        shot: makeShot({ startSec: 0.3 }),
      }),
    )
    expect(findings).toEqual([])
  })

  it('境界がビートに乗っていれば指摘を返さない', () => {
    const findings = musicReviewer(
      makeMeasurements({
        musicAnalysis: makeMusicAnalysis(),
        shot: makeShot({ startSec: 2, durationSec: 4 }),
      }),
    )
    expect(findings).toEqual([])
  })

  it('16 分グリッド上のカットは指摘しない', () => {
    const findings = musicReviewer(
      makeMeasurements({
        musicAnalysis: makeMusicAnalysis(),
        shot: makeShot({ startSec: 0.125, durationSec: 0.5 }),
      }),
    )
    expect(findings).toEqual([])
  })

  it('許容誤差内のズレは指摘しない', () => {
    const findings = musicReviewer(
      makeMeasurements({
        musicAnalysis: makeMusicAnalysis(),
        shot: makeShot({ startSec: 0.02, durationSec: 4 }),
      }),
    )
    expect(findings).toEqual([])
  })

  it('開始がグリッドから外れていれば warn', () => {
    const findings = musicReviewer(
      makeMeasurements({
        musicAnalysis: makeMusicAnalysis(),
        // 終了は 6.00 でグリッドに乗せ、開始のズレだけを見る。
        shot: makeShot({ startSec: 2.06, durationSec: 3.94, sourceInSec: 0.15 }),
      }),
    )

    expect(severities(findings)).toEqual(['warn'])
    expect(findings[0]?.message).toContain('開始')
    // evidence はメディア内の秒数。タイムライン秒をそのまま入れない。
    expect(findings[0]?.evidence?.frameSec).toBe(0.15)
    expect(findings[0]?.suggestedPromptDelta).toBeNull()
  })

  it('終了がグリッドから外れていれば warn', () => {
    const findings = musicReviewer(
      makeMeasurements({
        musicAnalysis: makeMusicAnalysis(),
        shot: makeShot({ startSec: 0, durationSec: 3.8, sourceInSec: 0.1 }),
      }),
    )

    expect(severities(findings)).toEqual(['warn'])
    expect(findings[0]?.message).toContain('終了')
    expect(findings[0]?.evidence?.frameSec).toBeCloseTo(3.9, 10)
  })

  it('グリッドの外側にある Shot は判定しない', () => {
    const findings = musicReviewer(
      makeMeasurements({
        musicAnalysis: makeMusicAnalysis(),
        shot: makeShot({ startSec: 40.3, durationSec: 4 }),
      }),
    )
    expect(findings).toEqual([])
  })

  describe('ドロップ', () => {
    it('Shot の途中にあるドロップを指摘する', () => {
      const findings = musicReviewer(
        makeMeasurements({
          musicAnalysis: makeMusicAnalysis({ drops: [3] }),
          shot: makeShot({ startSec: 2, durationSec: 4, sourceInSec: 0.15 }),
        }),
      )

      expect(severities(findings)).toEqual(['warn'])
      expect(findings[0]?.message).toContain('ドロップ')
      expect(findings[0]?.evidence?.frameSec).toBeCloseTo(1.15, 10)
    })

    it('カット上のドロップは指摘しない', () => {
      const findings = musicReviewer(
        makeMeasurements({
          musicAnalysis: makeMusicAnalysis({ drops: [2.03, 6] }),
          shot: makeShot({ startSec: 2, durationSec: 4 }),
        }),
      )
      expect(findings).toEqual([])
    })

    it('複数のドロップは時間順に返る', () => {
      const findings = musicReviewer(
        makeMeasurements({
          musicAnalysis: makeMusicAnalysis({ drops: [5, 3] }),
          shot: makeShot({ startSec: 2, durationSec: 4 }),
        }),
      )

      expect(findings).toHaveLength(2)
      expect(findings.map((f) => f.evidence?.frameSec)).toEqual([1, 3])
    })

    it('Shot の外のドロップは指摘しない', () => {
      const findings = musicReviewer(
        makeMeasurements({
          musicAnalysis: makeMusicAnalysis({ drops: [10] }),
          shot: makeShot({ startSec: 2, durationSec: 4 }),
        }),
      )
      expect(findings).toEqual([])
    })
  })

  it('入力を破壊的に変更しない', () => {
    const measurements = makeMeasurements({
      musicAnalysis: makeMusicAnalysis({ drops: [5, 3] }),
      shot: makeShot({ startSec: 2.06, durationSec: 4 }),
    })
    const before = snapshot(measurements)
    musicReviewer(measurements)
    expect(snapshot(measurements)).toBe(before)
  })
})
