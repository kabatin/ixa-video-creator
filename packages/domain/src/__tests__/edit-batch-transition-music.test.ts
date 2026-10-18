import { describe, expect, it } from 'vitest'
import { EditBatchId, MusicTrackId, ProjectId, ShotId, TransitionId, newId } from '../common/ids.js'
import { EditBatch, EditBatchMusicEntry, EditBatchShotEdit, EditBatchTransitionEdit, canUndo } from '../shot/edit-batch.js'

/**
 * トランジションの置く・消す・差し替えと、楽曲の欄の直し・マスターの切り替えの記録（2026-10-19 の見直し）。
 */

const base = {
  id: newId(EditBatchId),
  projectId: newId(ProjectId),
  kind: 'transition_edit',
  summary: 'トランジションを消す',
  entries: [],
  undoneAt: null,
  createdAt: new Date(),
}

const before = { fromShotId: newId(ShotId), toShotId: newId(ShotId), type: 'dissolve', durationSec: 0.5 }

describe('EditBatchTransitionEdit', () => {
  it('置いた物は控えを持たず、消した物は控えを持つ', () => {
    const transitionId = newId(TransitionId)
    expect(EditBatchTransitionEdit.parse({ op: 'create', transitionId })).toEqual({ op: 'create', transitionId })
    expect(EditBatchTransitionEdit.parse({ op: 'delete', transitionId, before }).op).toBe('delete')
  })

  it('消した物に控えが無い・知らない種別は受け付けない', () => {
    const transitionId = newId(TransitionId)
    expect(EditBatchTransitionEdit.safeParse({ op: 'delete', transitionId }).success).toBe(false)
    expect(EditBatchTransitionEdit.safeParse({ op: 'delete', transitionId, before: { ...before, type: 'spin' } }).success).toBe(false)
  })

  it('これまでの記録は空として読み、トランジションの記録だけでも取り消せる', () => {
    expect(EditBatch.parse({ ...base, kind: 'rough_cut' }).transitionEdits).toEqual([])
    const batch = EditBatch.parse({ ...base, transitionEdits: [{ op: 'delete', transitionId: newId(TransitionId), before }] })
    expect(canUndo(batch)).toBe(true)
  })
})

describe('EditBatchMusicEntry（広げた形）', () => {
  const musicTrackId = newId(MusicTrackId)

  it('曲を切った記録（曲の終わりとフェードアウト）はこれまでどおり読める', () => {
    expect(EditBatchMusicEntry.parse({ musicTrackId, endSec: null, fadeOutSec: 0 })).toEqual({
      musicTrackId,
      endSec: null,
      fadeOutSec: 0,
    })
  })

  it('直した欄だけを持てる（欄が無いのは触っていない）', () => {
    expect(EditBatchMusicEntry.parse({ musicTrackId, title: '前の題', volume: 0.8 })).toEqual({
      musicTrackId,
      title: '前の題',
      volume: 0.8,
    })
    expect(EditBatchMusicEntry.parse({ musicTrackId, master: true })).toEqual({ musicTrackId, master: true })
  })

  it('楽曲に入っていた値はそのまま控える（空の題も、前後の空白も）。欄の無いところに既定値を入れない', () => {
    expect(EditBatchMusicEntry.parse({ musicTrackId, title: '' })).toEqual({ musicTrackId, title: '' })
    expect(EditBatchMusicEntry.parse({ musicTrackId, title: ' 曲 ' })).toEqual({ musicTrackId, title: ' 曲 ' })
    expect(EditBatchMusicEntry.parse({ musicTrackId })).toEqual({ musicTrackId })
  })

  it('範囲外の値は受け付けない', () => {
    expect(EditBatchMusicEntry.safeParse({ musicTrackId, volume: 3 }).success).toBe(false)
    expect(EditBatchMusicEntry.safeParse({ musicTrackId, offsetSec: -1 }).success).toBe(false)
    expect(EditBatchMusicEntry.safeParse({ musicTrackId, master: false }).success).toBe(false)
  })
})

describe('EditBatchShotEdit（Shot の作成・削除）', () => {
  it('作った・消した Shot の ID を持つ（消した Shot は論理削除なので中身は DB に残る）', () => {
    const shotId = newId(ShotId)
    expect(EditBatchShotEdit.parse({ op: 'create', shotId })).toEqual({ op: 'create', shotId })
    expect(EditBatchShotEdit.parse({ op: 'delete', shotId })).toEqual({ op: 'delete', shotId })
    expect(EditBatchShotEdit.safeParse({ op: 'split', shotId }).success).toBe(false)
  })

  it('これまでの記録は空として読み、Shot の作成・削除だけでも取り消せる', () => {
    expect(EditBatch.parse({ ...base, kind: 'rough_cut' }).shotEdits).toEqual([])
    expect(canUndo(EditBatch.parse({ ...base, kind: 'shot_edit', shotEdits: [{ op: 'delete', shotId: newId(ShotId) }] }))).toBe(true)
  })
})
