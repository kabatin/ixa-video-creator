import { describe, expect, it } from 'vitest'
import {
  CharacterId,
  CharacterLookId,
  EditBatchId,
  MusicTrackId,
  ProjectId,
  ShotId,
  TextStyleId,
  TransitionId,
  VoiceProfileId,
  newId,
} from '../common/ids.js'
import {
  EditBatch,
  EditBatchAssetEdit,
  EditBatchEntry,
  EditBatchMusicEntry,
  EditBatchProjectEntry,
  EditBatchShotEdit,
  EditBatchTransitionEdit,
  assetEditSummary,
  canUndo,
  hasChanges,
} from '../shot/edit-batch.js'

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

describe('Shot の登場人物・開始フレームの記録（EditBatchEntry）', () => {
  const shotId = newId(ShotId)
  const cast = [{ characterId: newId(CharacterId), lookId: newId(CharacterLookId), prominence: 'primary', order: 0 }]

  it('登場人物は丸ごと、開始フレームは素材（無ければ null）を控えられる。欄が無いのは触っていない', () => {
    expect(EditBatchEntry.parse({ shotId, patch: {}, cast })).toEqual({ shotId, patch: {}, cast })
    expect(EditBatchEntry.parse({ shotId, patch: {}, startFrame: null })).toEqual({ shotId, patch: {}, startFrame: null })
    expect(hasChanges(EditBatchEntry.parse({ shotId, patch: {}, cast: [] }))).toBe(true)
    expect(hasChanges(EditBatchEntry.parse({ shotId, patch: {}, startFrame: null }))).toBe(true)
    expect(hasChanges(EditBatchEntry.parse({ shotId, patch: {} }))).toBe(false)
  })

  it('壊れた登場人物は受け付けない', () => {
    expect(EditBatchEntry.safeParse({ shotId, patch: {}, cast: [{ ...cast[0], prominence: 'star' }] }).success).toBe(false)
  })
})

describe('作品の記録（EditBatchProjectEntry）', () => {
  it('変えた欄の、変える前の値だけを持つ。欄の無いところに既定値を入れない', () => {
    expect(EditBatchProjectEntry.parse({ patch: { lyrics: '', lyricCues: [] } })).toEqual({ patch: { lyrics: '', lyricCues: [] } })
    expect(EditBatchProjectEntry.parse({ patch: {} })).toEqual({ patch: {} })
  })

  it('作品の値の規則で読む（壊れた値・知らない欄は受け付けない）', () => {
    expect(EditBatchProjectEntry.safeParse({ patch: { lyricCues: [-1] } }).success).toBe(false)
    expect(EditBatchProjectEntry.safeParse({ patch: { workspaceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' } }).success).toBe(false)
  })

  it('これまでの記録は無いものとして読み、作品の記録だけでも取り消せる', () => {
    expect(EditBatch.parse({ ...base, kind: 'rough_cut' }).projectEntry).toBeNull()
    expect(canUndo(EditBatch.parse({ ...base, kind: 'project_edit', projectEntry: { patch: { avoid: '' } } }))).toBe(true)
  })
})

describe('素材の記録（EditBatchAssetEdit）', () => {
  it('作った・消した素材は ID だけ、直した素材は変えた欄の変える前を持つ', () => {
    const id = newId(CharacterId)
    expect(EditBatchAssetEdit.parse({ asset: 'character', op: 'delete', id })).toEqual({ asset: 'character', op: 'delete', id })
    expect(EditBatchAssetEdit.parse({ asset: 'character', op: 'update', id, before: { name: '前の名前' } })).toEqual({
      asset: 'character',
      op: 'update',
      id,
      before: { name: '前の名前' },
    })
  })

  it('知らない素材・直した素材に控えが無い・壊れた値は受け付けない', () => {
    const id = newId(CharacterId)
    expect(EditBatchAssetEdit.safeParse({ asset: 'prop', op: 'delete', id }).success).toBe(false)
    expect(EditBatchAssetEdit.safeParse({ asset: 'character', op: 'update', id }).success).toBe(false)
    expect(EditBatchAssetEdit.safeParse({ asset: 'character', op: 'update', id, before: { name: '' } }).success).toBe(false)
  })

  it('見出しは素材の種類と名前で言う', () => {
    expect(assetEditSummary({ asset: 'location', op: 'delete' }, '夕方の店')).toBe('ロケーション「夕方の店」を消す')
    expect(assetEditSummary({ asset: 'voice', op: 'update' }, '戦子の声')).toBe('声「戦子の声」を直す')
  })

  it('これまでの記録は空として読み、素材の記録だけでも取り消せる', () => {
    expect(EditBatch.parse({ ...base, kind: 'rough_cut' }).assetEdits).toEqual([])
    const batch = EditBatch.parse({ ...base, kind: 'asset_edit', assetEdits: [{ asset: 'voice', op: 'create', id: newId(VoiceProfileId) }] })
    expect(canUndo(batch)).toBe(true)
  })
})

describe('テロップのスタイルの記録', () => {
  it('素材の記録として持て、見出しは「テロップのスタイル」で言う', () => {
    const id = newId(TextStyleId)
    expect(EditBatchAssetEdit.parse({ asset: 'text_style', op: 'update', id, before: { name: '歌詞' } }).asset).toBe('text_style')
    expect(EditBatchAssetEdit.safeParse({ asset: 'text_style', op: 'update', id, before: { name: '' } }).success).toBe(false)
    expect(assetEditSummary({ asset: 'text_style', op: 'delete' }, '歌詞')).toBe('テロップのスタイル「歌詞」を消す')
  })
})
