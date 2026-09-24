import { NEAR_BEAT_SEC, ON_BEAT_SEC, Shot, ShotId, type BeatAlignment } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  alignmentByShotId,
  beatAlignmentToneClass,
  buildShotAlignments,
  chipRingClass,
  countByAlignment,
  describeDrift,
  posterEdgeClass,
  summarizeBeatAlignment,
  type ShotBeatAlignmentView,
} from '@/lib/beat-alignment-view'
import { shotJson } from './fixtures'

/**
 * 拍とのズレの表示（P63-1）。
 *
 * ここで守りたいのは 3 つ。
 * 1. **しきい値をこのファイルに書かない**（定数を import して境界を作る / L-016）
 * 2. 「拍が分からない」を「ズレている」と同じ色・同じ文にしない（L-015）
 * 3. 色だけで終わらせず、必ず件数の 1 行が出る
 */

const BEATS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
const DOWNBEATS = [0, 2]

const aShot = (startSec: number, index: number): Shot =>
  Shot.parse({
    ...shotJson,
    id: ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5F${String(index).padStart(2, '0')}`),
    code: `S01-${String(index).padStart(3, '0')}`,
    startSec,
    durationSec: 0.5,
    createdAt: new Date(shotJson.createdAt),
    updatedAt: new Date(shotJson.updatedAt),
  })

const shotsAt = (startSecs: readonly number[]): readonly Shot[] =>
  startSecs.map((startSec, index) => aShot(startSec, index))

const viewsAt = (startSecs: readonly number[]): readonly ShotBeatAlignmentView[] =>
  buildShotAlignments(shotsAt(startSecs), BEATS, DOWNBEATS)

const aView = (alignment: BeatAlignment, index = 0): ShotBeatAlignmentView => ({
  shotId: aShot(0, index).id,
  atSec: 1,
  nearestBeatSec: alignment === 'no_beats' ? null : 1,
  driftSec: alignment === 'no_beats' ? null : 0.01,
  alignment,
})

describe('buildShotAlignments', () => {
  it('Shot の開始位置を拍に当てる', () => {
    const views = viewsAt([2, 1.5, 1 + NEAR_BEAT_SEC * 2])
    expect(views.map((view) => view.alignment)).toEqual(['on_downbeat', 'on_beat', 'off_beat'])
    expect(views[0]?.shotId).toBe(shotsAt([2])[0]?.id)
  })

  it('拍が 1 件も無ければ no_beats になり、ズレを名乗らない', () => {
    const views = buildShotAlignments(shotsAt([1.234]), [], [])
    expect(views[0]?.alignment).toBe('no_beats')
    expect(views[0]?.driftSec).toBeNull()
  })

  it('Shot が無ければ空', () => {
    expect(buildShotAlignments([], BEATS, DOWNBEATS)).toEqual([])
  })
})

describe('alignmentByShotId', () => {
  it('Shot の id で引ける', () => {
    const views = viewsAt([2, 1.5])
    const map = alignmentByShotId(views)
    expect(map.get(views[1]?.shotId ?? ShotId.parse(shotJson.id))?.alignment).toBe('on_beat')
    expect(map.size).toBe(2)
  })
})

describe('describeDrift', () => {
  it('符号つきでズレを添える', () => {
    const [late] = viewsAt([1 + ON_BEAT_SEC / 2])
    expect(describeDrift(late as ShotBeatAlignmentView)).toContain('+0.010s')

    const [early] = viewsAt([1.5 - ON_BEAT_SEC / 2])
    expect(describeDrift(early as ShotBeatAlignmentView)).toContain('-0.010s')
  })

  it('拍が分からないときは 0 秒と書かない（乗っていると読めるため）', () => {
    const text = describeDrift(aView('no_beats'))
    expect(text).not.toContain('0.000')
    expect(text).toContain('拍が分かっていません')
  })
})

describe('chipRingClass', () => {
  /**
   * **拍以外に合わせているのは間違いではない。**
   * 本制作で実測したところ、外れている 16 件は半拍の 56〜91% に集中し、
   * 0〜0.136s には 1 件も無かった。手で外したならそこに散らばる。
   * 拍ではないもの（歌い出し・言葉の頭）に合わせて切った形であって、
   * 吸着させると 0.14〜0.22s 動く＝耳で合わせた位置を壊す。
   * 道具が編集の意図を警告の色で咎めない（制作者の判断 2026-09-24）。
   */
  it('拍に乗っているものだけ色を付け、そうでないものを警告色にしない', () => {
    expect(chipRingClass({ rendered: true, alignment: 'on_downbeat' })).toContain('ring-ok')
    expect(chipRingClass({ rendered: true, alignment: 'near' })).not.toContain('warn')
    expect(chipRingClass({ rendered: true, alignment: 'off_beat' })).not.toContain('danger')
  })

  it('拍が分からないときはズレの色を使わない', () => {
    const className = chipRingClass({ rendered: true, alignment: 'no_beats' })
    expect(className).not.toContain('warn')
    expect(className).not.toContain('danger')
    expect(className).not.toContain('ok')
  })

  it('載っていない Shot（Take 無し）の縁を拍の色で上書きしない', () => {
    // 映像に出ない Shot は、拍に乗っているかより先に「載っていない」を見せる。
    const className = chipRingClass({ rendered: false, alignment: 'off_beat' })
    expect(className).toContain('ring-warn/40')
    expect(className).not.toContain('danger')
  })

  it('整列が分からないうち（取得前）は従来の縁のまま', () => {
    expect(chipRingClass({ rendered: true, alignment: null })).toBe('ring-1 ring-line-strong')
  })
})

describe('posterEdgeClass', () => {
  it('拍に乗っているものだけ塗る。拍以外を警告色にしない', () => {
    expect(posterEdgeClass('on_downbeat')).toContain('border-l-ok')
    expect(posterEdgeClass('off_beat')).not.toContain('danger')
    expect(posterEdgeClass('near')).not.toContain('warn')
  })

  it('拍が分からない・取得前は何も塗らない', () => {
    expect(posterEdgeClass('no_beats')).toBe('')
    expect(posterEdgeClass(null)).toBe('')
  })
})

describe('countByAlignment', () => {
  it('種別ごとに数える。出てこない種別は 0', () => {
    const counts = countByAlignment([aView('off_beat', 1), aView('off_beat', 2), aView('on_beat', 3)])
    expect(counts.off_beat).toBe(2)
    expect(counts.on_beat).toBe(1)
    expect(counts.near).toBe(0)
  })

  it('入力を変更しない', () => {
    const views = [aView('near', 1)]
    countByAlignment(views)
    expect(views).toHaveLength(1)
    expect(views[0]?.alignment).toBe('near')
  })
})

describe('summarizeBeatAlignment', () => {
  const summarize = (
    source: 'available' | 'no_beats' | 'no_analysis' | 'no_track',
    views: readonly ShotBeatAlignmentView[],
    trackTitle: string | null = 'iXA CUP',
  ) => summarizeBeatAlignment({ source, trackTitle, views })

  /**
   * **事実だけを出す。間違いとして書かない**（制作者の判断 2026-09-24）。
   * 本制作の実測では、外れている 16 件は半拍の 56〜91% に集中し 0〜0.136s は 0 件だった。
   * 手で外したなら散らばる形にならない。拍ではないもの（歌い出し・言葉の頭）に
   * 合わせて切った編集であって、吸着させれば耳で合わせた位置が壊れる。
   */
  it('乗っている数と拍以外の数を並べる（咎めない）', () => {
    const views = [
      ...Array.from({ length: 3 }, (_unused, index) => aView('on_beat', index)),
      aView('off_beat', 9),
    ]
    const summary = summarize('available', views)
    expect(summary.text).toContain('拍に乗っている 3 件')
    expect(summary.text).toContain('拍以外に合わせている 1 件')
    expect(summary.text).not.toContain('外れ')
    expect(summary.tone).not.toBe('danger')
    expect(summary.tone).not.toBe('warn')
  })

  it('わずかなズレも「拍以外」として同じ側で数える', () => {
    const summary = summarize('available', [aView('off_beat', 1), aView('near', 2)])
    expect(summary.text).toContain('拍以外に合わせている 2 件')
  })

  it('小節頭も拍に乗っている側で数える', () => {
    const summary = summarize('available', [aView('on_downbeat', 1), aView('off_beat', 2)])
    expect(summary.text).toContain('拍に乗っている 1 件')
  })

  it('すべて乗っていれば、そのことと小節頭の数を出す', () => {
    const summary = summarize('available', [aView('on_downbeat', 1), aView('on_beat', 2)])
    expect(summary.tone).toBe('ok')
    expect(summary.text).toContain('2 件すべてが拍に乗っています')
    expect(summary.text).toContain('1 件は小節頭')
  })

  it('解析が無いときに「0 件が外れています」と言わない', () => {
    const summary = summarize('no_analysis', [aView('no_beats', 1), aView('no_beats', 2)])
    expect(summary.text).not.toContain('外れています')
    expect(summary.text).toContain('解析')
    expect(summary.tone).toBe('warn')
  })

  it('楽曲が無い・拍が 0 件・解析が無いをそれぞれ別の文にする', () => {
    const noTrack = summarize('no_track', [], null).text
    const noBeats = summarize('no_beats', []).text
    const noAnalysis = summarize('no_analysis', []).text
    expect(new Set([noTrack, noBeats, noAnalysis]).size).toBe(3)
    expect(noTrack).toContain('楽曲が登録されていない')
    expect(noBeats).toContain('拍が 1 件もない')
  })

  it('Shot が 1 件も無いときは件数の文を出さない', () => {
    expect(summarize('available', []).text).toBe('Shot がまだありません')
  })
})

describe('beatAlignmentToneClass', () => {
  it('役割の名前だけを返す（素の色名を使わない）', () => {
    expect(beatAlignmentToneClass('danger')).toBe('text-danger')
    expect(beatAlignmentToneClass('muted')).toBe('text-muted')
  })
})
