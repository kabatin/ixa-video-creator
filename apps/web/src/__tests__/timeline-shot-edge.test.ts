import { Shot, ShotId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import type { ClipDragOutcome } from '@/lib/timeline-drag'
import { shotEdgeEdit, shotEdgeGrabBlocked, shotEdgeNeighbors } from '@/lib/timeline-shot-edge'
import { shotJson } from './fixtures'

/**
 * カット（VIDEO1 の Shot）の端をドラッグして長さを変える（制作者 2026-10-02「CUT4 の右側をつまんで右に移動したら
 * CUT5 の先頭が後ろに追従して下がる感じ、逆もしかり、左側も同様」）。
 * 当てるのは粗編集の適用（古さ・ロックの検査と変更の履歴がある）。ここは掴めるか・何を送るかを決める。
 */

const id = (n: number): ShotId => ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, '0')}`)
const shot = (n: number, startSec: number, durationSec: number, extra: Partial<Shot> = {}): Shot =>
  Shot.parse({
    ...shotJson,
    createdAt: new Date(shotJson.createdAt),
    updatedAt: new Date(shotJson.updatedAt),
    ...extra,
    id: id(n),
    code: `CUT-0${String(n)}`,
    startSec,
    durationSec,
  })

// CUT-01 0–4 / CUT-02 4–6 / CUT-03 6–9 が接している。
const shots = [shot(1, 0, 4), shot(2, 4, 2), shot(3, 6, 3)]

const outcome = (
  handle: 'start' | 'end',
  span: { startSec: number; durationSec: number },
  neighbor: ClipDragOutcome['neighbor'],
): ClipDragOutcome => ({
  handle,
  origin: span,
  requested: span,
  span,
  moved: true,
  snapNotices: [],
  limits: [],
  neighbor,
})

describe('shotEdgeEdit', () => {
  it('右端を右へ動かすと、境目の変更（前の trim・後ろの move と trim）を見出し付きで出す', () => {
    const edit = shotEdgeEdit(
      shots,
      shots[1] as Shot,
      outcome('end', { startSec: 4, durationSec: 3 }, { id: id(3), span: { startSec: 7, durationSec: 2 } }),
    )

    expect(edit.problem).toBeNull()
    expect(edit.summary).toBe('CUT-02 と CUT-03 の境目を動かしました')
    expect(edit.changes.map((change) => [change.kind, change.shotId])).toEqual([
      ['trim', id(2)],
      ['move', id(3)],
      ['trim', id(3)],
    ])
  })

  it('左端を左へ動かすと、前の終わりが付いてくる', () => {
    const edit = shotEdgeEdit(
      shots,
      shots[1] as Shot,
      outcome('start', { startSec: 3, durationSec: 3 }, { id: id(1), span: { startSec: 0, durationSec: 3 } }),
    )

    expect(edit.summary).toBe('CUT-01 と CUT-02 の境目を動かしました')
    expect(edit.changes).toEqual([
      expect.objectContaining({ kind: 'trim', shotId: id(1), toDurationSec: 3 }),
      expect.objectContaining({ kind: 'move', shotId: id(2), toSec: 3 }),
      expect.objectContaining({ kind: 'trim', shotId: id(2), toDurationSec: 3 }),
    ])
  })

  it('隣が付いてこない端（先頭の左端・Option）は、そのカットだけを変える', () => {
    const edit = shotEdgeEdit(shots, shots[0] as Shot, outcome('start', { startSec: 1, durationSec: 3 }, null))

    expect(edit.summary).toBe('CUT-01 の長さを変えました')
    expect(edit.changes.map((change) => [change.kind, change.shotId])).toEqual([
      ['move', id(1)],
      ['trim', id(1)],
    ])
  })

  it('動いていなければ何も送らない', () => {
    const edit = shotEdgeEdit(shots, shots[0] as Shot, {
      ...outcome('end', { startSec: 0, durationSec: 4 }, null),
      moved: false,
    })

    expect(edit.changes).toEqual([])
    expect(edit.problem).toBeNull()
  })
})

describe('shotEdgeGrabBlocked', () => {
  it('自分か、付いてくる隣がロック・生成中なら、掴んだ時点で理由を出す', () => {
    const locked = [shot(1, 0, 4), shot(2, 4, 2), shot(3, 6, 3, { lockedAt: new Date('2026-10-01T00:00:00Z') })]
    const generating = [shot(1, 0, 4, { status: 'generating' }), shot(2, 4, 2), shot(3, 6, 3)]
    const middle = (list: readonly Shot[]): Shot => list[1] as Shot

    expect(shotEdgeGrabBlocked(middle(locked), 'end', shotEdgeNeighbors(locked, middle(locked)), locked)).toMatch(/CUT-03.*ロック/)
    expect(shotEdgeGrabBlocked(middle(locked), 'start', shotEdgeNeighbors(locked, middle(locked)), locked)).toBeNull()
    expect(
      shotEdgeGrabBlocked(middle(generating), 'start', shotEdgeNeighbors(generating, middle(generating)), generating),
    ).toMatch(/CUT-01 は生成中/)
    expect(
      shotEdgeGrabBlocked(generating[0] as Shot, 'end', shotEdgeNeighbors(generating, generating[0] as Shot), generating),
    ).toMatch(/CUT-01 は生成中/)
  })
})
