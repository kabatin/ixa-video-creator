import { describe, expect, it } from 'vitest'
import {
  AspectRatio,
  CreateProjectInput,
  DEFAULT_PROJECT_KIND,
  Project,
  ProjectDemoKey,
  ProjectKind,
  UpdateProjectPatch,
  projectKindRule,
} from '../index.js'

/**
 * 作品の種類（何を作るか）と、同梱の見本の印（`demoKey`）。
 * 種類は新しい作品の画面で選び、一覧で素材置き場を畳む。見本の印は 1 回だけ入れるためのもので、画面からは付けられない。
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

describe('作品の種類の規則', () => {
  it('どの種類にも規則がある（種類を足したら表も足す）', () => {
    for (const kind of ProjectKind.options) {
      const rule = projectKindRule(kind)
      expect(['music', 'narration', 'none']).toContain(rule.startsFrom)
      if (rule.defaultAspectRatio !== null) expect(AspectRatio.options).toContain(rule.defaultAspectRatio)
    }
  })

  it('曲から始める・ナレーションから始める・何もしない、と既定の形', () => {
    expect(projectKindRule('mv')).toEqual({ startsFrom: 'music', defaultAspectRatio: '16:9' })
    expect(projectKindRule('short')).toEqual({ startsFrom: 'music', defaultAspectRatio: '9:16' })
    expect(projectKindRule('kamishibai')).toEqual({ startsFrom: 'narration', defaultAspectRatio: '16:9' })
    expect(projectKindRule('cm')).toEqual({ startsFrom: 'narration', defaultAspectRatio: '16:9' })
    expect(projectKindRule('library')).toEqual({ startsFrom: 'none', defaultAspectRatio: null })
  })

  it('知らない種類は受け付けない', () => {
    expect(ProjectKind.safeParse('anime').success).toBe(false)
    expect(Project.safeParse({ ...base, kind: 'anime' }).success).toBe(false)
  })
})

describe('作品の種類', () => {
  it('これまでの作品はミュージックビデオとして読み、見本の印は無し', () => {
    expect(DEFAULT_PROJECT_KIND).toBe('mv')
    expect(Project.parse(base)).toMatchObject({ kind: 'mv', demoKey: null })
  })

  it('作るときは省略できる（省略はミュージックビデオ）。選んだ種類はそのまま', () => {
    const input = { workspaceId: base.workspaceId, name: 'x', fps: 30, resolution: base.resolution, aspectRatio: '16:9' }
    expect(CreateProjectInput.parse(input).kind).toBe('mv')
    expect(CreateProjectInput.parse({ ...input, kind: 'kamishibai' }).kind).toBe('kamishibai')
    expect(CreateProjectInput.safeParse({ ...input, kind: 'anime' }).success).toBe(false)
  })

  it('後から変えられる。ほかの欄だけ直したときは種類を触らない', () => {
    expect(UpdateProjectPatch.parse({ kind: 'library' })).toEqual({ kind: 'library' })
    expect('kind' in UpdateProjectPatch.parse({ name: '改名' })).toBe(false)
    expect(UpdateProjectPatch.safeParse({ kind: 'anime' }).success).toBe(false)
  })
})

describe('見本の印（demoKey）', () => {
  it('小文字・数字・ハイフンの短い名前', () => {
    expect(ProjectDemoKey.parse('ixa-demo-v1')).toBe('ixa-demo-v1')
    expect(ProjectDemoKey.parse('a'.repeat(64))).toHaveLength(64)
  })

  it.each([
    ['空', ''],
    ['長すぎる', 'a'.repeat(65)],
    ['大文字', 'IXA-demo'],
    ['ハイフンで始まる', '-demo'],
    ['空白', 'ixa demo'],
    ['記号', 'ixa_demo'],
  ])('%s は受け付けない', (_label, value) => {
    expect(ProjectDemoKey.safeParse(value).success).toBe(false)
    expect(Project.safeParse({ ...base, demoKey: value }).success).toBe(false)
  })

  /** 作る・直すの口からは付けられない（任意の作品を見本にさせない）。知らない欄と同じく黙って落とす。 */
  it('作る入力・直す差分からは落ちる', () => {
    const input = { workspaceId: base.workspaceId, name: 'x', fps: 30, resolution: base.resolution, aspectRatio: '16:9' }
    expect('demoKey' in CreateProjectInput.parse({ ...input, demoKey: 'ixa-demo-v1' })).toBe(false)
    expect(UpdateProjectPatch.parse({ demoKey: 'ixa-demo-v1' })).toEqual({})
    expect(UpdateProjectPatch.parse({ name: '改名', demoKey: 'ixa-demo-v1' })).toEqual({ name: '改名' })
  })
})
