import { describe, expect, it } from 'vitest'
import { EditBatch, canUndo } from '../shot/edit-batch.js'

/**
 * 変更の履歴をテロップにも広げる（制作者 2026-10-02「テロップをまとめて、サイズやスタイルや位置を変えられるようにしたい」）。
 * まとめて変えたテロップの、変える前の見た目（`style` と `styleId`）を持ち、取り消しで戻す。
 */

const base = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  kind: 'text_style',
  summary: '歌詞のテロップ 2 件の大きさを変えました',
  entries: [],
  undoneAt: null,
  createdAt: new Date('2026-10-02T00:00:00Z'),
}

const clipEntry = { clipId: '01ARZ3NDEKTSV4RRFFQ69G5FAX', style: { size: 0.05 }, styleId: null }

describe('EditBatch のテロップの記録', () => {
  it('テロップの変える前の見た目を持てる。これまでの記録（clipEntries 無し）は空として読む', () => {
    expect(EditBatch.parse({ ...base, clipEntries: [clipEntry] }).clipEntries).toEqual([clipEntry])
    expect(EditBatch.parse({ ...base, kind: 'rough_cut' }).clipEntries).toEqual([])
  })

  it('知らない種類は受け付けない', () => {
    expect(EditBatch.safeParse({ ...base, kind: 'text_size' }).success).toBe(false)
  })

  it('テロップの記録だけでも取り消せる。Shot もテロップも無ければ取り消せない', () => {
    expect(canUndo(EditBatch.parse({ ...base, clipEntries: [clipEntry] }))).toBe(true)
    expect(canUndo(EditBatch.parse(base))).toBe(false)
  })
})
