import { TimelineClip } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { QUICK_TEXT_DURATION_SEC, planQuickText } from '@/lib/timeline-quick-text'
import { PROJECT_ID } from './fixtures'

/**
 * 「＋テロップ」で置く場所（制作者 2026-10-19）。再生位置から 2 秒。
 * 埋まっていれば、空いている段に重ねる。曲の終わりからははみ出さない。
 */

let serial = 0
const clip = (startSec: number, durationSec: number, layer: number, track = 'TEXT'): TimelineClip => {
  serial += 1
  return TimelineClip.parse({
    id: `01ARZ3NDEKTSV4RRFFQ69G5F${String(serial).padStart(2, '0')}`,
    projectId: PROJECT_ID,
    track,
    startSec,
    durationSec,
    layer,
    content: { type: 'text', templateKey: 'lower_third', params: { text: 'x' } },
    opacity: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  })
}

describe('planQuickText', () => {
  it('空いていれば再生位置から 2 秒、いちばん下の段', () => {
    expect(QUICK_TEXT_DURATION_SEC).toBe(2)
    expect(planQuickText({ clips: [], atSec: 3, programEndSec: 30 })).toEqual({
      startSec: 3,
      durationSec: 2,
      layer: 0,
    })
  })

  it('いちばん下の段が埋まっていれば、空いている上の段', () => {
    const clips = [clip(2, 3, 0)]
    expect(planQuickText({ clips, atSec: 3, programEndSec: 30 }).layer).toBe(1)
  })

  it('途中の段が空いていればそこを使う（いちばん上の次の段より先に）', () => {
    const clips = [clip(2, 3, 0), clip(10, 1, 1), clip(2, 3, 2)]
    expect(planQuickText({ clips, atSec: 3, programEndSec: 30 }).layer).toBe(1)
  })

  it('全部の段が埋まっていれば、いちばん上の次の段', () => {
    const clips = [clip(2, 3, 0), clip(3, 3, 1)]
    expect(planQuickText({ clips, atSec: 3, programEndSec: 30 }).layer).toBe(2)
  })

  it('接しているだけなら重なりとみなさない', () => {
    const clips = [clip(1, 2, 0), clip(5, 1, 0)]
    expect(planQuickText({ clips, atSec: 3, programEndSec: 30 }).layer).toBe(0)
  })

  it('テロップ以外の帯のクリップは数えない', () => {
    const clips = [clip(2, 3, 0, 'VFX')]
    expect(planQuickText({ clips, atSec: 3, programEndSec: 30 }).layer).toBe(0)
  })

  it('曲の終わり間際なら、終わりに収まるよう前へずらす', () => {
    expect(planQuickText({ clips: [], atSec: 29.5, programEndSec: 30 })).toEqual({
      startSec: 28,
      durationSec: 2,
      layer: 0,
    })
  })

  it('全体が 2 秒より短ければ、頭から終わりまで', () => {
    expect(planQuickText({ clips: [], atSec: 1, programEndSec: 1.5 })).toEqual({
      startSec: 0,
      durationSec: 1.5,
      layer: 0,
    })
  })

  it('尺が分からない（0）なら再生位置から 2 秒（はみ出しは警告で済む）', () => {
    expect(planQuickText({ clips: [], atSec: 0, programEndSec: 0 })).toEqual({
      startSec: 0,
      durationSec: 2,
      layer: 0,
    })
  })

  it('負の位置は 0 に寄せる', () => {
    expect(planQuickText({ clips: [], atSec: -1, programEndSec: 30 }).startSec).toBe(0)
  })
})
