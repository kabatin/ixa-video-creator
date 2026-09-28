import { describe, expect, it } from 'vitest'
import {
  editPointsOf,
  frameStepTarget,
  nextEditPoint,
  previousEditPoint,
} from '@/lib/transport-steps'

/**
 * 再生の操作列の「1 コマ戻る・進む」「前の境目へ・次の境目へ」（一般的な動画編集ツールと同じ並び）。
 * 1 コマは書き出しと同じ 1/fps 秒。境目は Shot の頭と終わり、曲の頭と終わり。
 */

const FPS = 30

describe('frameStepTarget', () => {
  it('1 コマ進む・戻る（コマの格子に乗せる）', () => {
    expect(frameStepTarget(1, 1, FPS, 10)).toBeCloseTo(31 / 30)
    expect(frameStepTarget(1, -1, FPS, 10)).toBeCloseTo(29 / 30)
  })

  /** 1.02 秒に出ているのは 1.00 秒から始まるコマ（30 コマ目）。そこから 1 コマ前後へ。 */
  it('コマの途中にいるときは、いま出ているコマから数える', () => {
    expect(frameStepTarget(1.02, 1, FPS, 10)).toBeCloseTo(31 / 30)
    expect(frameStepTarget(1.02, -1, FPS, 10)).toBeCloseTo(29 / 30)
  })

  it('浮動小数の誤差でコマを取り違えない', () => {
    expect(frameStepTarget(31 / 30, 1, FPS, 10)).toBeCloseTo(32 / 30)
  })

  /**
   * 音声の要素は位置をマイクロ秒ほどの細かさで持つので、286/30 秒へ飛ばすと 285.99999 コマで返ってくる
   * （Chrome で実測）。その値が共有の位置に戻るので、ここで 1 つ手前のコマと取り違えると
   * 「1 コマ進む → 1 コマ戻る」で元の位置より 1 コマ前へ行った。
   */
  it('再生器が返すコマの頭のわずか手前の値を、手前のコマと取り違えない', () => {
    expect(frameStepTarget(285.99999 / 30, -1, FPS, 20)).toBeCloseTo(285 / 30)
  })

  it('頭より前・尺より後ろへは出ない', () => {
    expect(frameStepTarget(0, -1, FPS, 10)).toBe(0)
    expect(frameStepTarget(10, 1, FPS, 10)).toBe(10)
  })
})

describe('editPointsOf', () => {
  it('Shot の頭と終わり・曲の頭と終わりを、重ねずに昇順で並べる', () => {
    const shots = [
      { startSec: 5, durationSec: 4.5 },
      { startSec: 0, durationSec: 5 },
    ]
    expect(editPointsOf(shots, 12)).toEqual([0, 5, 9.5, 12])
  })

  it('尺が分からなければ、Shot の境目だけ', () => {
    expect(editPointsOf([{ startSec: 2, durationSec: 3 }], null)).toEqual([0, 2, 5])
  })
})

describe('前の境目へ・次の境目へ', () => {
  const points = [0, 5, 9.5, 12]

  it('境目の上にいるときは、その 1 つ前・1 つ後へ（同じ場所に留まらない）', () => {
    expect(previousEditPoint(points, 5, FPS)).toBe(0)
    expect(nextEditPoint(points, 5, FPS)).toBe(9.5)
  })

  it('境目の間にいるときは、手前・先の境目へ', () => {
    expect(previousEditPoint(points, 7, FPS)).toBe(5)
    expect(nextEditPoint(points, 7, FPS)).toBe(9.5)
  })

  it('頭より前・最後より後ろは無い（null）', () => {
    expect(previousEditPoint(points, 0, FPS)).toBeNull()
    expect(nextEditPoint(points, 12, FPS)).toBeNull()
  })
})
