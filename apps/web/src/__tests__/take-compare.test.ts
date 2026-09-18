import { describe, expect, it } from 'vitest'
import {
  beatTicks,
  beatsInShot,
  clampToSpan,
  compareColumns,
  compareNoticeClassName,
  describeBeatState,
  describeCompareState,
  secAtSpanFraction,
  spanEndSec,
  spanPercent,
  type CompareSpan,
} from '@/lib/take-compare'

/**
 * A/B 比較の表示ロジック。**React を含まない純粋関数だけ**を確かめる。
 *
 * ここで守りたいのは 2 つ。
 * 1. 区間に入る拍だけを出し、**隣の Shot の頭を自分の拍として数えない**
 * 2. 「比較するものが無い」と「読めていない」を別の文で出す（L-015）
 */

const span: CompareSpan = { startSec: 40, durationSec: 4 }

describe('beatsInShot', () => {
  it('区間に入る拍だけを返す', () => {
    expect(beatsInShot([38, 39.9, 40, 41.5, 43.9, 45], 40, 4)).toEqual([40, 41.5, 43.9])
  })

  it('開始ちょうどの拍は含む', () => {
    expect(beatsInShot([40], 40, 4)).toEqual([40])
  })

  /** 終端の拍は**次の Shot のもの**。ここに出すと隣の頭を自分の拍として数える。 */
  it('終端ちょうどの拍は含まない', () => {
    expect(beatsInShot([44], 40, 4)).toEqual([])
  })

  it('尺が 0 以下なら 1 件も返さない', () => {
    expect(beatsInShot([40, 41], 40, 0)).toEqual([])
    expect(beatsInShot([40, 41], 40, -1)).toEqual([])
  })

  it('入力の配列を書き換えない', () => {
    const beats = [45, 40, 41]
    beatsInShot(beats, 40, 4)
    expect(beats).toEqual([45, 40, 41])
  })
})

describe('spanPercent / secAtSpanFraction', () => {
  it('区間の先頭は 0%、終端は 100%', () => {
    expect(spanPercent(40, span)).toBe(0)
    expect(spanPercent(44, span)).toBe(100)
  })

  it('区間の途中を割合に直す', () => {
    expect(spanPercent(41, span)).toBe(25)
  })

  /** 0 で割ると先頭へ飛ぶ。「押した場所へ行かない」ではなく「勝手に戻る」に見える。 */
  it('尺が 0 のときは 0 を返す（0 で割らない）', () => {
    expect(spanPercent(40, { startSec: 40, durationSec: 0 })).toBe(0)
  })

  it('押した割合から秒へ戻す', () => {
    expect(secAtSpanFraction(0.5, span)).toBe(42)
  })

  it('区間の外を押しても内側に収める', () => {
    expect(secAtSpanFraction(-1, span)).toBe(40)
    expect(secAtSpanFraction(2, span)).toBe(44)
  })

  it('clampToSpan は区間の外を内側へ戻す', () => {
    expect(clampToSpan(10, span)).toBe(40)
    expect(clampToSpan(100, span)).toBe(44)
    expect(clampToSpan(41, span)).toBe(41)
  })

  it('spanEndSec は開始 + 尺', () => {
    expect(spanEndSec(span)).toBe(44)
  })
})

describe('beatTicks', () => {
  it('時間順に並べ、位置を百分率で返す', () => {
    const ticks = beatTicks([43, 40, 41, 50], span)

    expect(ticks.map((tick) => tick.sec)).toEqual([40, 41, 43])
    expect(ticks.map((tick) => tick.percent)).toEqual([0, 25, 75])
  })

  it('先頭の拍だけに印を付ける', () => {
    expect(beatTicks([40, 41], span).map((tick) => tick.isFirst)).toEqual([true, false])
  })

  it('区間に拍が無ければ空', () => {
    expect(beatTicks([10, 100], span)).toEqual([])
  })
})

describe('describeCompareState', () => {
  it('両方そろっていれば何も言わない', () => {
    expect(describeCompareState(null)).toBeNull()
  })

  /** **待てば直る／操作しないと直らない**が混ざると、利用者は待ち続ける（L-015）。 */
  it('理由ごとに別の文を出す', () => {
    const headlines = [
      'b_not_requested',
      'b_same_as_a',
      'b_not_found',
      'b_media_unresolved',
      'a_media_unresolved',
    ].map((reason) => describeCompareState(reason as 'b_not_found')?.headline)

    expect(new Set(headlines).size).toBe(5)
  })

  it('選んでいないだけなら警告にしない', () => {
    expect(describeCompareState('b_not_requested')?.tone).toBe('ok')
  })

  it('素材を読めないのは警告より強く出す', () => {
    expect(describeCompareState('b_media_unresolved')?.tone).toBe('error')
    expect(describeCompareState('a_media_unresolved')?.tone).toBe('error')
  })

  it('同じ Take を選んだのは操作で直るので警告', () => {
    expect(describeCompareState('b_same_as_a')?.tone).toBe('warn')
  })
})

describe('describeBeatState', () => {
  it('拍が読めていて区間にも入っていれば何も言わない', () => {
    expect(describeBeatState('available', 3)).toBeNull()
  })

  /** 曲には拍があるのに区間に入らないのは、解析が無いのとは直し方が違う。 */
  it('解析はあるが区間に拍が無いことを、解析が無いことと分ける', () => {
    const inSpan = describeBeatState('available', 0)
    const noAnalysis = describeBeatState('no_analysis', 0)

    expect(inSpan?.headline).not.toBe(noAnalysis?.headline)
    expect(inSpan?.headline).toContain('この区間')
  })

  it('楽曲が無い・解析が無い・拍が 0 件を別の文で出す', () => {
    const headlines = ['no_track', 'no_analysis', 'no_beats'].map(
      (state) => describeBeatState(state as 'no_track', 0)?.headline,
    )

    expect(new Set(headlines).size).toBe(3)
  })
})

describe('見た目', () => {
  it('色は役割の名前で返す', () => {
    expect(compareNoticeClassName('ok')).toBe('text-muted')
    expect(compareNoticeClassName('warn')).toBe('text-warn')
    expect(compareNoticeClassName('error')).toBe('text-danger')
  })

  it('B が無いときは 1 列、あるときは 2 列', () => {
    expect(compareColumns(false)).toBe(1)
    expect(compareColumns(true)).toBe(2)
  })
})
