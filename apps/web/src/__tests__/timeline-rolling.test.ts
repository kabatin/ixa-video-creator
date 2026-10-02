import { describe, expect, it } from 'vitest'
import { applyClipDrag, beginClipDrag, type ClipDragContext, type TimelineBounds } from '@/lib/timeline-drag'
import { adjacentIds, edgeNeighbors, rollEdge, shrinkFirst, type RollingItem } from '@/lib/timeline-rolling'
import { snapToleranceSec } from '@/lib/timeline-snap'

/**
 * 端を動かすと、接している隣の端が付いてくる（制作者 2026-10-02「CUT4 の右側をつまんで右に移動したら CUT5 の先頭が
 * 後ろに追従して下がる感じ、逆もしかり、左側も同様」「テロップも同じですね」）。
 * 接していなければ隣にぶつかって止まる（重ならない）。Option（Alt）なら隣は動かさない。
 */

// 0–4 / 4–6（自分）/ 6–9 が接している。10–12 は離れている。
const before: RollingItem = { id: 'before', span: { startSec: 0, durationSec: 4 } }
const self: RollingItem = { id: 'self', span: { startSec: 4, durationSec: 2 } }
const after: RollingItem = { id: 'after', span: { startSec: 6, durationSec: 3 } }
const far: RollingItem = { id: 'far', span: { startSec: 10, durationSec: 2 } }

describe('edgeNeighbors', () => {
  it('接している前後と、接していなければぶつかる相手を見つける。1 コマ未満の差は接しているとみなす', () => {
    const near = edgeNeighbors([before, self, after], self)
    expect(near.before.adjacent?.id).toBe('before')
    expect(near.after.adjacent?.id).toBe('after')

    const loose = edgeNeighbors([self, far, { id: 'tiny', span: { startSec: 0, durationSec: 3.996 } }], self)
    expect(loose.before.adjacent?.id).toBe('tiny')
    expect(loose.after.adjacent).toBeNull()
    expect(loose.after.blocking?.id).toBe('far')
  })
})

describe('rollEdge', () => {
  const neighbors = edgeNeighbors([before, self, after, far], self)

  it('右端を右へ動かすと、次の頭が付いてくる（次は短くなる）', () => {
    const rolled = rollEdge({ handle: 'end', span: { startSec: 4, durationSec: 3 }, neighbors, minNeighborSec: 0.1, detach: false, noun: 'テロップ' })

    expect(rolled.span).toEqual({ startSec: 4, durationSec: 3 })
    expect(rolled.neighbor).toEqual({ id: 'after', span: { startSec: 7, durationSec: 2 } })
  })

  it('左端を左へ動かすと、前の終わりが付いてくる（前は短くなる）', () => {
    const rolled = rollEdge({ handle: 'start', span: { startSec: 3, durationSec: 3 }, neighbors, minNeighborSec: 0.1, detach: false, noun: 'テロップ' })

    expect(rolled.neighbor).toEqual({ id: 'before', span: { startSec: 0, durationSec: 3 } })
  })

  it('隣が最小の尺になる所で止め、理由を言う', () => {
    const rolled = rollEdge({ handle: 'end', span: { startSec: 4, durationSec: 5 }, neighbors, minNeighborSec: 0.5, detach: false, noun: 'カット' })

    expect(rolled.span).toEqual({ startSec: 4, durationSec: 4.5 })
    expect(rolled.neighbor).toEqual({ id: 'after', span: { startSec: 8.5, durationSec: 0.5 } })
    expect(rolled.limit).toMatch(/隣のカット/)
  })

  it('Option（Alt）なら隣は動かさず、隣にぶつかる所で止める', () => {
    const rolled = rollEdge({ handle: 'end', span: { startSec: 4, durationSec: 3 }, neighbors, minNeighborSec: 0.1, detach: true, noun: 'テロップ' })

    expect(rolled.neighbor).toBeNull()
    expect(rolled.span).toEqual({ startSec: 4, durationSec: 2 })
  })

  it('接していなければ、隣にぶつかる所で止める（重ならない）', () => {
    const lone = edgeNeighbors([self, far], self)
    const rolled = rollEdge({ handle: 'end', span: { startSec: 4, durationSec: 8 }, neighbors: lone, minNeighborSec: 0.1, detach: false, noun: 'テロップ' })

    expect(rolled.span).toEqual({ startSec: 4, durationSec: 6 })
    expect(rolled.neighbor).toBeNull()
  })
})

describe('applyClipDrag に隣を渡したとき', () => {
  const BOUNDS: TimelineBounds = { left: 100 }
  const PX = 40
  const xAt = (sec: number): number => BOUNDS.left + sec * PX
  const context = (detachable: Partial<ClipDragContext> = {}): ClipDragContext => ({
    candidates: [],
    toleranceSec: snapToleranceSec(PX),
    snapEnabled: true,
    timelineEndSec: 20,
    neighbors: edgeNeighbors([before, self, after], self),
    minNeighborSec: 0.1,
    neighborNoun: 'テロップ',
    ...detachable,
  })

  it('端を動かした結果に、付いてきた隣の区間を添える。Option なら添えない', () => {
    const drag = beginClipDrag(self.span, xAt(6), BOUNDS, PX)
    if (drag === null) throw new Error('右端を掴めませんでした')

    const rolled = applyClipDrag(drag, xAt(7), BOUNDS, PX, context())
    expect(rolled.span).toEqual({ startSec: 4, durationSec: 3 })
    expect(rolled.neighbor).toEqual({ id: 'after', span: { startSec: 7, durationSec: 2 } })

    const detached = applyClipDrag(drag, xAt(5.5), BOUNDS, PX, context(), { detach: true })
    expect(detached.neighbor).toBeNull()
    expect(detached.span).toEqual({ startSec: 4, durationSec: 1.5 })
  })
})

describe('付いてくる隣を書く', () => {
  it('吸着の候補から外すのは、接している隣だけ（離れた相手の端には吸い寄せる）', () => {
    expect(adjacentIds(edgeNeighbors([before, self, after, far], self))).toEqual(['before', 'after'])
    expect(adjacentIds(edgeNeighbors([self, far], self))).toEqual([])
  })

  it('縮む側を先に書く（一瞬でも重ならない順）', () => {
    const grow = { id: 'self', from: { startSec: 4, durationSec: 2 }, to: { startSec: 4, durationSec: 3 } }
    const shrink = { id: 'after', from: { startSec: 6, durationSec: 3 }, to: { startSec: 7, durationSec: 2 } }

    expect(shrinkFirst([grow, shrink]).map((write) => write.id)).toEqual(['after', 'self'])
    expect(shrinkFirst([shrink, grow]).map((write) => write.id)).toEqual(['after', 'self'])
  })
})
