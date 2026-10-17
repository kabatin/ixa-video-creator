import { describe, expect, it } from 'vitest'
import { SfxCue } from '../sfx/sfx-job.js'
import { suggestSfxCues, type SfxSuggestionInput } from '../sfx/sfx-suggest.js'

/** 効果音のきっかけの案（ADR-0052 §3）。エフェクトとトランジションから、どこで何が鳴るとよいかを出す。 */

type Clip = SfxSuggestionInput['clips'][number]
const effect = (templateKey: string, startSec: number, durationSec = 0.5, params: Record<string, unknown> = {}): Clip => ({
  track: 'VFX',
  startSec,
  durationSec,
  content: { type: 'motion_graphics', templateKey, params },
})

const input = (overrides: Partial<SfxSuggestionInput> = {}): SfxSuggestionInput => ({
  video1: [
    { shotId: 's1', startSec: 0 },
    { shotId: 's2', startSec: 4 },
    { shotId: 's3', startSec: 9 },
  ],
  transitions: [],
  clips: [],
  ...overrides,
})

describe('suggestSfxCues', () => {
  it('エフェクトごとに決まった種類の音を、時刻順に出す', () => {
    const result = suggestSfxCues(
      input({
        clips: [
          effect('title_card', 0, 2),
          effect('shake', 7),
          effect('flash', 3.5),
          effect('speed_lines', 5, 2.4),
        ],
      }),
    )
    expect(result.map((s) => [s.kind, s.cue.startSec, s.cue.durationSec])).toEqual([
      ['boom', 0, 2.5],
      ['impact', 3.5, 1],
      ['pass_by', 5, 2.4],
      ['thud', 7, 0.8],
    ])
    expect(result.map((s) => s.reason)).toEqual([
      'タイトルカードに合わせた低い衝撃音',
      'フラッシュに合わせた衝撃音',
      'スピード線に合わせた走り抜ける風切り音',
      '揺れに合わせた鈍い衝撃音',
    ])
  })

  it('案はそのまま作れる（説明は英語・長さと音量は契約の範囲）', () => {
    const result = suggestSfxCues(
      input({
        clips: [effect('flash', 1), effect('speed_lines', 2, 30), effect('speed_lines', 40, 0.1), effect('title_card', 50)],
        transitions: [{ fromShotId: 's1', toShotId: 's2', type: 'whip_pan', durationSec: 0.4 }],
      }),
    )
    expect(result.length).toBe(5)
    for (const suggestion of result) expect(SfxCue.safeParse(suggestion.cue).success).toBe(true)
  })

  it('スピード線の長さは 0.5〜10 秒に収める', () => {
    const result = suggestSfxCues(input({ clips: [effect('speed_lines', 0, 30), effect('speed_lines', 20, 0.1)] }))
    expect(result.map((s) => s.cue.durationSec)).toEqual([10, 0.5])
  })

  it('寄りのパンチは寄りきる時刻で鳴らす（クリップの外へは出さない）', () => {
    const result = suggestSfxCues(
      input({ clips: [effect('zoom_punch', 2, 0.6, { peakAtSec: 0.2 }), effect('zoom_punch', 6, 0.6, { peakAtSec: 5 })] }),
    )
    expect(result.map((s) => s.cue.startSec)).toEqual([2.2, 6.6])
  })

  it('ウィップパンは境目をまたいで風切り音を鳴らす。ほかのトランジションは案を出さない', () => {
    const result = suggestSfxCues(
      input({
        transitions: [
          { fromShotId: 's1', toShotId: 's2', type: 'whip_pan', durationSec: 0.4 },
          { fromShotId: 's2', toShotId: 's3', type: 'dissolve', durationSec: 1 },
        ],
      }),
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'whoosh', cue: { startSec: 3.6, durationSec: 0.8 } })
  })

  it('境目の先の Shot がタイムラインに無いウィップパンは飛ばす。頭の境目は 0 秒より前にしない', () => {
    const result = suggestSfxCues(
      input({
        video1: [{ shotId: 's1', startSec: 0.1 }],
        transitions: [
          { fromShotId: 's0', toShotId: 's1', type: 'whip_pan', durationSec: 0 },
          { fromShotId: 's1', toShotId: 'gone', type: 'whip_pan', durationSec: 0 },
        ],
      }),
    )
    expect(result.map((s) => s.cue.startSec)).toEqual([0])
  })

  it('同じ拍のフラッシュと寄りのパンチは衝撃音 1 つにまとめる。離れていれば 2 つ', () => {
    expect(suggestSfxCues(input({ clips: [effect('flash', 3), effect('zoom_punch', 3.1)] }))).toHaveLength(1)
    expect(suggestSfxCues(input({ clips: [effect('flash', 3), effect('zoom_punch', 3.2)] }))).toHaveLength(2)
    // 種類が違えば同じ時刻でもまとめない。
    expect(suggestSfxCues(input({ clips: [effect('flash', 3), effect('shake', 3)] }))).toHaveLength(2)
  })

  it('VFX の段のエフェクトだけを見る。音の出ない型（光漏れ・グリッチ）と知らない型は案を出さない', () => {
    const result = suggestSfxCues(
      input({
        clips: [
          { ...effect('flash', 1), track: 'TEXT' },
          { track: 'SFX', startSec: 1, durationSec: 1, content: { type: 'media' } },
          effect('light_leak', 2),
          effect('glitch', 3),
          effect('unknown', 4),
        ],
      }),
    )
    expect(result).toEqual([])
  })

  it('何も無ければ空', () => {
    expect(suggestSfxCues(input())).toEqual([])
  })
})
