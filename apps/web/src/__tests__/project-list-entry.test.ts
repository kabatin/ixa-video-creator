import { MediaAssetId, ProjectId, WorkspaceId, newId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import type { WireProjectListItem } from '@/lib/api-schemas'
import { PROJECT_LIST_ENTRY_KEYS, toProjectListEntry } from '@/lib/project-list-entry'

/**
 * 作品一覧の画面へ渡す行。**一覧が使う欄だけを写す。** 行をそのまま画面の部品へ渡すと、
 * 歌詞・作品の方針・予算などが全作品分ブラウザへ届く（使わないのに送る）。
 */

const fullRow: WireProjectListItem = {
  id: newId(ProjectId),
  workspaceId: newId(WorkspaceId),
  name: 'NIGHT RUN',
  kind: 'mv',
  demoKey: 'ixa-demo-v1',
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  durationSec: 116,
  budgetUsd: 50,
  styleGuide: 'cinematic',
  avoid: '文字',
  styleReferenceAssetIds: [newId(MediaAssetId)],
  lyrics: '夜明けの屋上で',
  lyricCues: [12.5],
  instrumental: false,
  masteringMode: 'peak',
  status: 'production',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-02T00:00:00.000Z'),
  activity: {
    lastActivityAt: new Date('2026-11-10T05:02:00.000Z'),
    shotCount: 27,
    adoptedTakeCount: 20,
    hasRender: true,
  },
}

describe('toProjectListEntry', () => {
  it('一覧が使う欄と表紙だけを持つ', () => {
    const cover = { url: null, reason: 'Take がありません' }
    const entry = toProjectListEntry(fullRow, cover)

    expect(Object.keys(entry).sort()).toEqual([...PROJECT_LIST_ENTRY_KEYS].sort())
    expect(entry).toEqual({
      id: fullRow.id,
      name: 'NIGHT RUN',
      kind: 'mv',
      status: 'production',
      createdAt: fullRow.createdAt,
      aspectRatio: '16:9',
      resolution: { width: 1920, height: 1080 },
      fps: 30,
      activity: fullRow.activity,
      cover,
    })
  })

  it('歌詞・作品の方針・予算・見本の印などは渡さない', () => {
    const entry = toProjectListEntry(fullRow, undefined)
    for (const heavy of [
      'workspaceId', 'lyrics', 'lyricCues', 'styleGuide', 'avoid', 'styleReferenceAssetIds',
      'budgetUsd', 'demoKey', 'durationSec', 'masteringMode', 'instrumental', 'updatedAt',
    ]) {
      expect(entry).not.toHaveProperty(heavy)
    }
  })

  it('表紙を繋いでいなければ undefined のまま（「絵が無い」と混ぜない）', () => {
    expect(toProjectListEntry(fullRow, undefined).cover).toBeUndefined()
  })
})
