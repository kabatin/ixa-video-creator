import { describe, expect, it } from 'vitest'
import { EditBatchId, MediaAssetId, NarrationLineId, ProjectId, TimelineClipId, newId } from '../common/ids.js'
import { EditBatch, canUndo } from '../shot/edit-batch.js'
import { EditBatchClipEdit, clipEditSummary, clipNounOf, clipSnapshotOf } from '../shot/edit-batch-clip-edit.js'
import { TimelineClip } from '../timeline/timeline.js'

/**
 * クリップ 1 件ずつの作る・直す・消すの記録（制作者 2026-10-19「『この効果音を消す』を押して消したけど、
 * 元に戻したい時に UNDO できなかった」）。変える前のクリップを丸ごと持ち、戻すと同じ ID・同じ中身になる。
 */

const sfx = TimelineClip.parse({
  id: newId(TimelineClipId),
  projectId: newId(ProjectId),
  track: 'SFX',
  startSec: 1.5,
  durationSec: 0.8,
  layer: 0,
  content: { type: 'media', mediaAssetId: newId(MediaAssetId), inSec: 0, outSec: 0.8, volume: 0.6, fadeOutSec: 0.1 },
  opacity: 1,
  createdAt: new Date('2026-10-19T00:00:00Z'),
})

const base = {
  id: newId(EditBatchId),
  projectId: sfx.projectId,
  kind: 'clip_edit',
  summary: '効果音を消す',
  entries: [],
  undoneAt: null,
  createdAt: new Date(),
}

describe('クリップの控え', () => {
  it('ID・作品・作った時刻を除いた丸ごとを持つ（中身はそのまま）', () => {
    expect(clipSnapshotOf(sfx)).toEqual({
      track: 'SFX',
      startSec: 1.5,
      durationSec: 0.8,
      layer: 0,
      content: sfx.content,
      opacity: 1,
    })
  })
})

describe('EditBatchClipEdit', () => {
  it('作った物は控えを持たず、直した物・消した物は控えを持つ', () => {
    expect(EditBatchClipEdit.parse({ op: 'create', clipId: sfx.id })).toEqual({ op: 'create', clipId: sfx.id })
    const before = clipSnapshotOf(sfx)
    expect(EditBatchClipEdit.parse({ op: 'delete', clipId: sfx.id, before }).op).toBe('delete')
    expect(EditBatchClipEdit.parse({ op: 'update', clipId: sfx.id, before }).op).toBe('update')
  })

  it('直した物・消した物に控えが無ければ受け付けない（戻す先が無い）', () => {
    expect(EditBatchClipEdit.safeParse({ op: 'delete', clipId: sfx.id }).success).toBe(false)
    expect(EditBatchClipEdit.safeParse({ op: 'update', clipId: sfx.id, before: null }).success).toBe(false)
  })

  it('知らない操作・壊れた控えは受け付けない', () => {
    expect(EditBatchClipEdit.safeParse({ op: 'move', clipId: sfx.id }).success).toBe(false)
    const broken = { ...clipSnapshotOf(sfx), durationSec: -1 }
    expect(EditBatchClipEdit.safeParse({ op: 'delete', clipId: sfx.id, before: broken }).success).toBe(false)
  })
})

describe('EditBatch のクリップの記録', () => {
  it('これまでの記録（clipEdits 無し）は空として読む', () => {
    expect(EditBatch.parse({ ...base, kind: 'rough_cut' }).clipEdits).toEqual([])
  })

  it('クリップの記録だけでも取り消せる', () => {
    const batch = EditBatch.parse({ ...base, clipEdits: [{ op: 'delete', clipId: sfx.id, before: clipSnapshotOf(sfx) }] })
    expect(canUndo(batch)).toBe(true)
    expect(canUndo(EditBatch.parse(base))).toBe(false)
  })

  it('行の記録は「テロップを出すか」だけでも持てる（位置は触っていない）', () => {
    const lineId = newId(NarrationLineId)
    const batch = EditBatch.parse({ ...base, lineEntries: [{ lineId, telop: true }] })
    expect(batch.lineEntries).toEqual([{ lineId, telop: true }])
  })
})

describe('見出し', () => {
  const text = { ...sfx, track: 'TEXT' as const, content: { type: 'text' as const, templateKey: 'plain', params: { text: 'あ' } } }
  const effect = { ...sfx, track: 'VFX' as const, content: { type: 'motion_graphics' as const, templateKey: 'flash', params: {} } }
  const overlay = { ...sfx, track: 'VIDEO2' as const }

  it('クリップの呼び名は中身と帯で決まる', () => {
    expect(clipNounOf(sfx)).toBe('効果音')
    expect(clipNounOf(text)).toBe('テロップ')
    expect(clipNounOf(effect)).toBe('エフェクト')
    expect(clipNounOf(overlay)).toBe('重ね素材')
  })

  it('置く・消す・直す・動かす（位置と尺だけ）', () => {
    expect(clipEditSummary('create', sfx)).toBe('効果音を置く')
    expect(clipEditSummary('delete', text)).toBe('テロップを消す')
    expect(clipEditSummary('update', effect, ['content'])).toBe('エフェクトを直す')
    expect(clipEditSummary('update', text, ['startSec', 'durationSec'])).toBe('テロップを動かす')
  })
})
