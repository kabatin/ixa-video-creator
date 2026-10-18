import { describe, expect, it } from 'vitest'
import { EditBatchId, NarrationLineId, ProjectId, newId } from '../common/ids.js'
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

/**
 * ナレーションをまとめて並べた記録（ADR-0038）。1 回押すと置いた行の位置が全部変わるので、戻せるようにする。
 * 行の記録（`lineEntries`）は、これまでの記録（Shot・テロップだけ）では空として読む。
 */
describe('ナレーションをまとめて並べた記録', () => {
  const lineId = newId(NarrationLineId)

  it('行ごとに「置く前の位置」を持つ（置いていなかった行は null）', () => {
    const batch = EditBatch.parse({
      id: newId(EditBatchId),
      projectId: newId(ProjectId),
      kind: 'narration_arrange',
      summary: 'ナレーション 3 行を 0:01.00 から並べました',
      entries: [],
      lineEntries: [{ lineId, startSec: 2.5 }, { lineId: newId(NarrationLineId), startSec: null }],
      undoneAt: null,
      createdAt: new Date(),
    })

    expect(batch.lineEntries).toHaveLength(2)
    expect(batch.clipEntries).toEqual([])
  })

  it('行だけを変えた記録も取り消せる（Shot もテロップも 0 件）', () => {
    const batch = EditBatch.parse({
      id: newId(EditBatchId),
      projectId: newId(ProjectId),
      kind: 'narration_arrange',
      summary: 'ナレーション 1 行を並べました',
      entries: [],
      lineEntries: [{ lineId, startSec: null }],
      undoneAt: null,
      createdAt: new Date(),
    })

    expect(canUndo(batch)).toBe(true)
    expect(canUndo({ ...batch, undoneAt: new Date() })).toBe(false)
  })

  it('何も変えていない記録は取り消せない', () => {
    const empty = EditBatch.parse({
      id: newId(EditBatchId),
      projectId: newId(ProjectId),
      kind: 'narration_arrange',
      summary: '並べる行がありませんでした',
      entries: [],
      lineEntries: [],
      undoneAt: null,
      createdAt: new Date(),
    })

    expect(canUndo(empty)).toBe(false)
  })
})

/**
 * 曲を最後の Shot で切った記録（制作者 2026-10-19「カットより長い部分は楽曲をカットするとか？」）。
 * 曲の終わりとフェードアウトの「変える前」を持ち、取り消しで戻す。
 */
describe('曲を切った記録', () => {
  const musicEntry = { musicTrackId: '01ARZ3NDEKTSV4RRFFQ69G5FAY', endSec: null, fadeOutSec: 0 }

  it('変える前の曲の終わり（null は自然な終わり）とフェードアウトを持つ。これまでの記録は空として読む', () => {
    expect(EditBatch.parse({ ...base, kind: 'music_trim', musicEntries: [musicEntry] }).musicEntries).toEqual([musicEntry])
    expect(EditBatch.parse(base).musicEntries).toEqual([])
  })

  it('曲の記録だけでも取り消せる', () => {
    expect(canUndo(EditBatch.parse({ ...base, kind: 'music_trim', musicEntries: [musicEntry] }))).toBe(true)
  })

  it('変える前の曲の終わりも正の秒だけ', () => {
    expect(EditBatch.safeParse({ ...base, kind: 'music_trim', musicEntries: [{ ...musicEntry, endSec: 0 }] }).success).toBe(false)
  })
})
