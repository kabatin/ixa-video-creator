import { describe, expect, it } from 'vitest'
import {
  NEAR_BEAT_SEC,
  ON_BEAT_SEC,
  alignBoundary,
  pickMasterTrack,
  type BeatAlignment,
} from '../music/beat-alignment.js'

/**
 * しきい値は本制作 Project の実測から取った（tasks/todo.md PHASE 6.3）。
 * 68 件の Shot 開始位置のうち 52 件が ±0.02s 以内、16 件が 0.08s 超、その間は 0 件。
 *
 * **テストはしきい値の数値を書き写さない。** 定数を import して境界を作る。
 * 書き写すと、しきい値を直したときにテストだけが古い値を守り続ける（lessons L-016）。
 */

// 120BPM 相当。拍は 0.5s 刻み、小節頭は 4 拍ごと。
const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
const downbeats = [0, 2]

const alignmentAt = (atSec: number): BeatAlignment =>
  alignBoundary(atSec, beats, downbeats).alignment

describe('alignBoundary — 拍が無いとき', () => {
  it('拍が 1 件も無ければ no_beats を返し、ズレを名乗らない', () => {
    const result = alignBoundary(1.23, [], [])
    expect(result.alignment).toBe('no_beats')
    expect(result.nearestBeatSec).toBeNull()
    expect(result.driftSec).toBeNull()
    expect(result.atSec).toBe(1.23)
  })

  it('小節頭だけあって拍が無い場合も no_beats（拍が正）', () => {
    expect(alignBoundary(2, [], [0, 2]).alignment).toBe('no_beats')
  })

  it('no_beats は off_beat と別物である', () => {
    // 同じ時刻でも、拍が分かっていれば off_beat、分かっていなければ no_beats。
    // 前者は Shot を動かさないと直らず、後者は解析を流せば直る。
    const atSec = 1.3
    expect(alignBoundary(atSec, beats, downbeats).alignment).toBe('off_beat')
    expect(alignBoundary(atSec, [], []).alignment).toBe('no_beats')
  })
})

describe('alignBoundary — 段階の判定', () => {
  it('小節頭に乗っていれば on_downbeat（on_beat より強い）', () => {
    expect(alignmentAt(2)).toBe('on_downbeat')
    expect(alignmentAt(2 + ON_BEAT_SEC / 2)).toBe('on_downbeat')
  })

  it('小節頭でない拍に乗っていれば on_beat', () => {
    expect(alignmentAt(1.5)).toBe('on_beat')
    expect(alignmentAt(1.5 - ON_BEAT_SEC / 2)).toBe('on_beat')
  })

  it('小節頭からわずかに外れていれば、小節頭ではなく拍として見る', () => {
    // 2.0 は小節頭。そこから ON_BEAT を超えて離れれば on_downbeat ではない。
    expect(alignmentAt(2 + ON_BEAT_SEC * 2)).toBe('near')
  })

  it('ON_BEAT を超え NEAR_BEAT 以内なら near', () => {
    expect(alignmentAt(1 + (ON_BEAT_SEC + NEAR_BEAT_SEC) / 2)).toBe('near')
  })

  it('NEAR_BEAT を超えたら off_beat', () => {
    expect(alignmentAt(1 + NEAR_BEAT_SEC * 1.5)).toBe('off_beat')
  })

  it('境界のすぐ内側と外側で判定が変わる', () => {
    // **しきい値ちょうどは試さない。** 1 + 0.02 の差は float では 0.020000000000000018 で、
    // 「ちょうど」は計算上そもそも作れない。試しているのは境目の向きであって浮動小数ではない。
    expect(alignmentAt(1 + ON_BEAT_SEC * 0.99)).toBe('on_beat')
    expect(alignmentAt(1 + ON_BEAT_SEC * 1.01)).toBe('near')
    expect(alignmentAt(1 + NEAR_BEAT_SEC * 0.99)).toBe('near')
    expect(alignmentAt(1 + NEAR_BEAT_SEC * 1.01)).toBe('off_beat')
  })

  it('しきい値は近い順に並んでいる', () => {
    expect(ON_BEAT_SEC).toBeLessThan(NEAR_BEAT_SEC)
  })
})

describe('alignBoundary — 一番近い拍とズレ', () => {
  it('一番近い拍と、符号つきのズレを返す', () => {
    const late = alignBoundary(1.03, beats, downbeats)
    expect(late.nearestBeatSec).toBe(1)
    expect(late.driftSec).toBeCloseTo(0.03, 6)

    const early = alignBoundary(0.97, beats, downbeats)
    expect(early.nearestBeatSec).toBe(1)
    expect(early.driftSec).toBeCloseTo(-0.03, 6)
  })

  it('前後どちらの拍が近いかで寄せ先が変わる', () => {
    expect(alignBoundary(1.26, beats, downbeats).nearestBeatSec).toBe(1.5)
    expect(alignBoundary(1.24, beats, downbeats).nearestBeatSec).toBe(1)
  })

  it('拍の列が昇順でなくても一番近い拍を選ぶ', () => {
    // 2.1 から見て 2 は 0.1、3.5 は 1.4、0 は 2.1。列の先頭ではなく一番近いものを選ぶ。
    expect(alignBoundary(2.1, [3.5, 0, 2], []).nearestBeatSec).toBe(2)
  })

  it('小節頭が拍の列に含まれていなくても on_downbeat を判定できる', () => {
    // 手で補正すると downbeats が beats の部分集合でなくなることがある。
    // **小節頭は downbeats の列だけで独立に見る。**
    const result = alignBoundary(4, [0, 0.5, 1], [4])
    expect(result.alignment).toBe('on_downbeat')
    // 一番近い「拍」は 1。ズレはその拍から測った値で、小節頭からの距離ではない。
    expect(result.nearestBeatSec).toBe(1)
    expect(result.driftSec).toBeCloseTo(3, 6)
  })

  it('小節頭が無ければ on_downbeat は出ない', () => {
    expect(alignBoundary(2, beats, []).alignment).toBe('on_beat')
  })

  it('atSec をそのまま返し、入力を変更しない', () => {
    const inputBeats = [0, 0.5, 1]
    const inputDownbeats = [0]
    const result = alignBoundary(0.51, inputBeats, inputDownbeats)
    expect(result.atSec).toBe(0.51)
    expect(inputBeats).toEqual([0, 0.5, 1])
    expect(inputDownbeats).toEqual([0])
  })
})

describe('alignBoundary — 実測の分布', () => {
  /**
   * 本制作 Project の実測（±0.02s 以内が 52 件、0.08s 超が 16 件、間は 0 件）と
   * 同じ形の入力を通し、2 段階で分けられることを確かめる。
   */
  it('実測と同じ二分した分布を、乗っている / 外れているに分けられる', () => {
    const onBeatSamples = [0.5, 1.0 + 0.004, 1.5 - 0.011, 2.5 + 0.019]
    const offBeatSamples = [1 + 0.09, 2.5 + 0.222, 3 - 0.15]

    for (const atSec of onBeatSamples) {
      expect(['on_beat', 'on_downbeat']).toContain(alignmentAt(atSec))
    }
    for (const atSec of offBeatSamples) {
      expect(alignmentAt(atSec)).toBe('off_beat')
    }
  })
})

describe('pickMasterTrack', () => {
  const track = (title: string, isMaster: boolean) => ({ title, isMaster })

  it('マスター音源があればそれを選ぶ（先頭ではない）', () => {
    const master = track('iXA CUP', true)
    expect(pickMasterTrack([track('SE 集', false), master])).toBe(master)
  })

  it('マスターが無ければ先頭を選ぶ', () => {
    const first = track('SE 集', false)
    expect(pickMasterTrack([first, track('別の曲', false)])).toBe(first)
  })

  it('1 件も無ければ null（「拍が無い」ではなく「楽曲が無い」）', () => {
    expect(pickMasterTrack([])).toBeNull()
  })

  it('マスターが複数あっても先に見つかった 1 件に決める', () => {
    const first = track('A', true)
    expect(pickMasterTrack([first, track('B', true)])).toBe(first)
  })
})
