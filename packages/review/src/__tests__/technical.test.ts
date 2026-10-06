import { describe, expect, it } from 'vitest'
import { technicalReviewer } from '../technical.js'
import {
  DEFAULT_FRAMES,
  makeFrame,
  makeMeasurements,
  makeShot,
  makeSpec,
  makeTake,
  makeVideo,
  snapshot,
} from './fixtures.js'

const severities = (findings: readonly { severity: string }[]): string[] =>
  findings.map((f) => f.severity)

describe('technicalReviewer', () => {
  it('要求どおりの測定値なら指摘を返さない', () => {
    expect(technicalReviewer(makeMeasurements())).toEqual([])
  })

  it('同じ入力なら同じ結果を返す（決定的）', () => {
    const measurements = makeMeasurements({ video: makeVideo({ width: 1280, height: 720 }) })
    expect(technicalReviewer(measurements)).toEqual(technicalReviewer(measurements))
  })

  it('入力を破壊的に変更しない', () => {
    const measurements = makeMeasurements({ video: makeVideo({ hasAudioStream: false }) })
    const before = snapshot(measurements)
    technicalReviewer(measurements)
    expect(snapshot(measurements)).toBe(before)
  })

  describe('尺', () => {
    it('sourceIn から編集尺を取れなければ fail', () => {
      const findings = technicalReviewer(
        makeMeasurements({
          shot: makeShot({ durationSec: 4, sourceInSec: 0.15 }),
          video: makeVideo({ durationSec: 4 }),
        }),
      )

      expect(severities(findings)).toEqual(['fail'])
      expect(findings[0]?.evidence?.frameSec).toBe(4)
      expect(findings[0]?.suggestedPromptDelta).toBeNull()
    })

    it('1 フレーム未満のズレは許容する', () => {
      const findings = technicalReviewer(
        makeMeasurements({ video: makeVideo({ durationSec: 3.98 }) }),
      )
      expect(findings).toEqual([])
    })

    it('編集尺は取れているが生成尺と違えば warn（ADR-0011 ののりしろ超過）', () => {
      const findings = technicalReviewer(
        makeMeasurements({
          shot: makeShot({ durationSec: 3.75 }),
          take: makeTake({ spec: makeSpec({ durationSec: 4 }) }),
          video: makeVideo({ durationSec: 5 }),
        }),
      )

      expect(severities(findings)).toEqual(['warn'])
      expect(findings[0]?.message).toContain('生成尺')
    })

    /**
     * ADR-0026 / 0040。`fit` の Shot は Take 全体を Shot の尺へ収める（0.5〜2.5 倍）ので、
     * 素材が編集尺より短いこと自体は異常ではない。**最長が短い AI を選ぶと必ず起きる**
     * （Wan 2.2 5B は 5 秒まで）。速度を考えずに引き算していた頃は、ここが必ず fail になっていた。
     */
    it('fit の Shot は、ゆっくり再生で埋まる範囲なら指摘しない', () => {
      const findings = technicalReviewer(
        makeMeasurements({
          shot: makeShot({ durationSec: 6, timing: 'fit' }),
          take: makeTake({ spec: makeSpec({ durationSec: 5 }) }),
          video: makeVideo({ durationSec: 5 }),
        }),
      )
      expect(findings).toEqual([])
    })

    it('fit でも、最も遅い再生でも埋まらなければ fail', () => {
      const findings = technicalReviewer(
        makeMeasurements({
          // 6 秒の Shot に 2 秒の素材。最も遅い 0.5 倍でも 4 秒しか埋まらない。
          shot: makeShot({ durationSec: 6, timing: 'fit' }),
          take: makeTake({ spec: makeSpec({ durationSec: 2 }) }),
          video: makeVideo({ durationSec: 2 }),
        }),
      )
      expect(severities(findings)).toEqual(['fail'])
      expect(findings[0]?.message).toContain('足りない')
    })

    it('trim の Shot は今までどおり、短ければ fail', () => {
      const findings = technicalReviewer(
        makeMeasurements({
          shot: makeShot({ durationSec: 6 }),
          take: makeTake({ spec: makeSpec({ durationSec: 6 }) }),
          video: makeVideo({ durationSec: 4 }),
        }),
      )
      expect(severities(findings)).toEqual(['fail'])
    })

    /** 速度では救えない形。`fit` でも「使えるところが無い」ことは見落とさない。 */
    it('切り出し位置より短い素材は fit でも fail', () => {
      const findings = technicalReviewer(
        makeMeasurements({
          shot: makeShot({ durationSec: 4, sourceInSec: 2, timing: 'fit' }),
          take: makeTake({ spec: makeSpec({ durationSec: 2 }) }),
          video: makeVideo({ durationSec: 2 }),
        }),
      )
      expect(severities(findings)).toEqual(['fail'])
    })

    it('生成尺どおり長い素材は指摘しない（のりしろは正常）', () => {
      const findings = technicalReviewer(
        makeMeasurements({
          shot: makeShot({ durationSec: 3.75, sourceInSec: 0.125 }),
          take: makeTake({ spec: makeSpec({ durationSec: 4 }) }),
          video: makeVideo({ durationSec: 4 }),
        }),
      )
      expect(findings).toEqual([])
    })
  })

  describe('解像度と fps', () => {
    it('要求より小さい解像度は fail', () => {
      const findings = technicalReviewer(
        makeMeasurements({ video: makeVideo({ width: 1280, height: 720 }) }),
      )

      expect(severities(findings)).toEqual(['fail'])
      expect(findings[0]?.suggestedPromptDelta).toBeNull()
    })

    it('比が違えば大きくても fail', () => {
      const findings = technicalReviewer(
        makeMeasurements({ video: makeVideo({ width: 2160, height: 2160 }) }),
      )
      expect(severities(findings)).toEqual(['fail'])
    })

    it('要求より大きく比が同じなら info（縮小して使える）', () => {
      const findings = technicalReviewer(
        makeMeasurements({ video: makeVideo({ width: 3840, height: 2160 }) }),
      )
      expect(severities(findings)).toEqual(['info'])
    })

    it('16px アライメントによる 1088 は同じ比として扱う', () => {
      const findings = technicalReviewer(
        makeMeasurements({ video: makeVideo({ width: 1920, height: 1088 }) }),
      )
      expect(severities(findings)).toEqual(['info'])
    })

    it('29.97fps は 30fps 要求に対して指摘しない（NTSC）', () => {
      const findings = technicalReviewer(
        makeMeasurements({ video: makeVideo({ fps: 30000 / 1001 }) }),
      )
      expect(findings).toEqual([])
    })

    it('24fps と 30fps の食い違いは warn', () => {
      const findings = technicalReviewer(makeMeasurements({ video: makeVideo({ fps: 24 }) }))

      expect(severities(findings)).toEqual(['warn'])
      expect(findings[0]?.message).toContain('fps')
    })
  })

  describe('フレーム', () => {
    it('フレームが 1 枚も無ければ fail', () => {
      const findings = technicalReviewer(makeMeasurements({ frames: [] }))

      expect(severities(findings)).toEqual(['fail'])
      expect(findings[0]?.evidence?.frameSec).toBeNull()
    })

    it('全フレームが黒なら fail を 1 件だけ返す', () => {
      const frames = [0, 1, 2, 3].map((atSec) => makeFrame(atSec, 0.005))
      const findings = technicalReviewer(makeMeasurements({ frames }))

      expect(severities(findings)).toEqual(['fail'])
      expect(findings[0]?.evidence?.frameSec).toBe(0)
    })

    it('閾値ちょうどの輝度は黒とみなさない', () => {
      const frames = [makeFrame(0, 0.02), makeFrame(1, 0.4), makeFrame(2, 0.5), makeFrame(3, 0.45)]
      expect(technicalReviewer(makeMeasurements({ frames }))).toEqual([])
    })

    it('使う区間の中に黒フレームがあれば fail', () => {
      const frames = [makeFrame(0, 0.4), makeFrame(1, 0.001), makeFrame(2, 0.5), makeFrame(3, 0.45)]
      const findings = technicalReviewer(makeMeasurements({ frames }))

      expect(severities(findings)).toEqual(['fail'])
      expect(findings[0]?.evidence?.frameSec).toBe(1)
    })

    it('のりしろの黒フレームは info', () => {
      const frames = [makeFrame(0, 0.001), makeFrame(1, 0.4), makeFrame(2, 0.5), makeFrame(3, 0.45)]
      const findings = technicalReviewer(
        makeMeasurements({
          frames,
          shot: makeShot({ durationSec: 3.5, sourceInSec: 0.15 }),
          take: makeTake({ spec: makeSpec({ durationSec: 4 }) }),
        }),
      )

      expect(severities(findings)).toEqual(['info'])
      expect(findings[0]?.evidence?.frameSec).toBe(0)
    })

    it('平均輝度がほぼ同一なら静止画化として warn', () => {
      const frames = [
        makeFrame(0, 0.5),
        makeFrame(1, 0.5004),
        makeFrame(2, 0.5001),
        makeFrame(3, 0.5002),
      ]
      const findings = technicalReviewer(makeMeasurements({ frames }))

      expect(severities(findings)).toEqual(['warn'])
      expect(findings[0]?.message).toContain('静止画化')
    })

    it('still_image の Shot では静止画化を指摘しない', () => {
      const frames = [makeFrame(0, 0.5), makeFrame(1, 0.5), makeFrame(2, 0.5)]
      const findings = technicalReviewer(
        makeMeasurements({
          frames,
          shot: makeShot({ sourceType: { type: 'still_image', mediaAssetId: null, kenBurns: null } }),
        }),
      )
      expect(findings).toEqual([])
    })

    it('フレームが 2 枚しか無ければ静止画化を判定しない', () => {
      const frames = [makeFrame(0, 0.5), makeFrame(1, 0.5)]
      expect(technicalReviewer(makeMeasurements({ frames }))).toEqual([])
    })
  })

  it('音声ストリームが無ければ info（無音そのものは欠陥ではない）', () => {
    const findings = technicalReviewer(
      makeMeasurements({ frames: DEFAULT_FRAMES, video: makeVideo({ hasAudioStream: false }) }),
    )

    expect(severities(findings)).toEqual(['info'])
    expect(findings[0]?.message).toContain('音声ストリーム')
  })
})
