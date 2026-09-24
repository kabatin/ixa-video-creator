import { describe, expect, it } from 'vitest'
import {
  alignmentCellText,
  alignmentMark,
  isDrifting,
  type ShotBeatAlignmentView,
} from '@/lib/beat-alignment-view'
import { ShotId } from '@ixa/domain'

/**
 * 一覧に出す拍ズレ。
 *
 * 集計の 1 行（「27 件中 16 件が拍から外れています」）だけでは、
 * **どれが・どれだけズレているか**が分からず、直す先へ行けなかった。
 * 6 割が該当する状態では、それは例外の印ではなく主要な情報になっている。
 */

const shotId = ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')

const view = (
  alignment: ShotBeatAlignmentView['alignment'],
  driftSec: number | null,
): ShotBeatAlignmentView => ({
  shotId,
  atSec: 10,
  nearestBeatSec: driftSec === null ? null : 10 - driftSec,
  driftSec,
  alignment,
})

describe('一覧のセル', () => {
  it('乗っているものに 0.00s と書かない（ズレていると読める）', () => {
    expect(alignmentCellText(view('on_beat', 0))).toBe(alignmentMark('on_beat'))
    expect(alignmentCellText(view('on_downbeat', 0))).toBe(alignmentMark('on_downbeat'))
  })

  /** 単位は列の見出し「拍」と title が持つ。右ペインは 320px で、列を増やすと状態が見切れる。 */
  it('ズレているものだけ秒を添える（単位はセルに書かない）', () => {
    expect(alignmentCellText(view('off_beat', 0.184))).toContain('+0.18')
    expect(alignmentCellText(view('near', -0.052))).toContain('-0.05')
    expect(alignmentCellText(view('off_beat', 0.184))).not.toContain('s')
  })

  it('拍が分かっていないときは秒を出さない', () => {
    expect(alignmentCellText(view('no_beats', null))).toBe(alignmentMark('no_beats'))
  })

  it('印は種類ごとに違う（色だけで区別させない）', () => {
    const marks = (['on_downbeat', 'on_beat', 'near', 'off_beat'] as const).map(alignmentMark)
    expect(new Set(marks).size).toBe(marks.length)
  })

  it('行が無ければ空（「—」を作らない）', () => {
    expect(alignmentCellText(undefined)).toBe('')
  })
})

describe('絞り込みの対象', () => {
  it('外れているものとわずかにズレているものを拾う', () => {
    expect(isDrifting(view('off_beat', 0.2))).toBe(true)
    expect(isDrifting(view('near', 0.03))).toBe(true)
  })

  it('乗っているもの・拍が無いものは拾わない', () => {
    expect(isDrifting(view('on_beat', 0))).toBe(false)
    expect(isDrifting(view('on_downbeat', 0))).toBe(false)
    expect(isDrifting(view('no_beats', null))).toBe(false)
  })

  it('行が無ければ拾わない（読めていないものをズレ扱いしない）', () => {
    expect(isDrifting(undefined)).toBe(false)
  })
})
