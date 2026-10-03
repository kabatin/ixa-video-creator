import { describe, expect, it } from 'vitest'
import { MAX_STYLE_REFERENCES, Project, UpdateProjectPatch } from '../index.js'

/**
 * 作品の方針（ADR-0030）。ルック（styleGuide）・避けたいもの・手本画像は Project に持つ。
 * コンセプト（あらすじ）は既存の脚本（Script）に持つので、ここには無い。
 */

const base = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  workspaceId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  name: 'LUNA BREW',
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  durationSec: null,
  budgetUsd: null,
  status: 'production',
  createdAt: new Date(),
  updatedAt: new Date(),
}
const asset = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5FB${String(n)}`

describe('作品の方針', () => {
  it('書いていなければ、避けたいものは空・手本画像は無し', () => {
    expect(Project.parse(base)).toMatchObject({ styleGuide: '', avoid: '', styleReferenceAssetIds: [] })
  })

  it('手本画像は 3 枚まで', () => {
    expect(Project.parse({ ...base, styleReferenceAssetIds: [asset(1), asset(2), asset(3)] }).styleReferenceAssetIds).toHaveLength(
      MAX_STYLE_REFERENCES,
    )
    expect(() => Project.parse({ ...base, styleReferenceAssetIds: [asset(1), asset(2), asset(3), asset(4)] })).toThrow()
  })

  /** 名前だけ直したときに、既定値（空）が入って手本画像や避けたいものが消えないこと。 */
  it('ほかの項目を直しても、書いていない方針の項目は触らない', () => {
    const patch = UpdateProjectPatch.parse({ name: '改名' })
    expect('avoid' in patch).toBe(false)
    expect('styleReferenceAssetIds' in patch).toBe(false)
  })
})

/**
 * 歌詞なし（制作者 2026-10-04「歌詞がない動画の場合、歌詞を入力しないので、作品の方針が 2/3 でとまってしまいます。
 * 歌詞なしのチェックボックスとかあるといいかも」）。既定は歌詞あり。直して保存できる。
 */
describe('歌詞なし', () => {
  it('既定は歌詞あり（false）。真偽値だけを受ける', () => {
    expect(Project.parse(base).instrumental).toBe(false)
    expect(UpdateProjectPatch.parse({ instrumental: true })).toEqual({ instrumental: true })
    expect(() => UpdateProjectPatch.parse({ instrumental: 'yes' })).toThrow()
  })
})
