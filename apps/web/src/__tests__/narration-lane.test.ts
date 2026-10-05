import { describe, expect, it } from 'vitest'
import { draggedStartSec, laneBlocks, nudgedStartSec, peaksPath } from '@/lib/narration-lane'

/** タイムラインのナレーションのレーン（ADR-0038）。行の投影（置いた行・選んだ声の長さ）。 */

const line = (patch: Record<string, unknown>) => ({
  id: 'l1',
  text: '勝負の時が来た。',
  startSec: 2,
  durationSec: 1.5,
  voiceProfileId: 'v2',
  selectedTakeId: 't1',
  takes: [{ id: 't1', peaks: [0.2, 1] }],
  ...patch,
})

describe('laneBlocks', () => {
  it('置いて声を選んだ行だけを、位置と声の長さで並べる。色は声ごと（声の並び順）', () => {
    const blocks = laneBlocks(
      [line({}), line({ id: 'l2', startSec: null }), line({ id: 'l3', durationSec: null, selectedTakeId: null })],
      ['v1', 'v2'],
    )
    expect(blocks).toEqual([{ lineId: 'l1', label: '勝負の時が来た。', startSec: 2, durationSec: 1.5, colorIndex: 1, peaks: [0.2, 1] }])
  })

  it('声が未定・一覧に無い声の行は、決まった色（0）にする', () => {
    expect(laneBlocks([line({ voiceProfileId: null })], ['v1'])[0]?.colorIndex).toBe(0)
  })
})

describe('draggedStartSec / nudgedStartSec', () => {
  it('動かした px を秒にして足す（0.01 秒に丸め、0 より前には出さない）', () => {
    expect(draggedStartSec(2, 50, 100)).toBe(2.5)
    expect(draggedStartSec(2, -500, 100)).toBe(0)
    expect(draggedStartSec(1, 33, 100)).toBe(1.33)
  })

  it('矢印で 0.1 秒、Shift で 1 秒ずつ動かす', () => {
    expect(nudgedStartSec(2, 'ArrowRight', false)).toBe(2.1)
    expect(nudgedStartSec(2, 'ArrowLeft', true)).toBe(1)
    expect(nudgedStartSec(0.05, 'ArrowLeft', false)).toBe(0)
    expect(nudgedStartSec(2, 'Enter', false)).toBeNull()
  })
})

describe('peaksPath', () => {
  it('波形の点を、幅と高さに合わせた縦線の道にする', () => {
    expect(peaksPath([0.5, 1], 10, 20)).toBe('M2.5 5V15M7.5 0V20')
    expect(peaksPath([], 10, 20)).toBe('')
  })
})
