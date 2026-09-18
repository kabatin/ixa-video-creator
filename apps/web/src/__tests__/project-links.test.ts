import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ProjectId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { PROJECT_ID } from '@/__tests__/fixtures'
import { PROJECT_SECTIONS, projectSectionHref } from '@/lib/project-links'
import { legacySectionHref } from '@/lib/workbench-url'

const projectId = ProjectId.parse(PROJECT_ID)

/**
 * **実装済みの画面に必ず行き先があるか**を、ディレクトリと突き合わせて確かめる。
 * PHASE 7.1 から各ディレクトリは旧 URL のリダイレクトだが、行き先の表は同じ組のまま保つ。
 *
 * 以前ストーリーボードとタイムラインが実装済みなのにどこからもリンクされておらず、
 * URL を直接打つしか到達手段が無かった。行き先を手で並べたテストだと、
 * 画面を足すたびに期待値を書き換えるだけで、**同じ漏れをまた見逃す**。
 * ディレクトリを正にすれば、画面を足した人が行き先を足し忘れたときに落ちる。
 */
const projectPagesDir = fileURLToPath(new URL('../app/projects/[id]', import.meta.url))

const implementedSections = (): readonly string[] =>
  readdirSync(projectPagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

describe('Project 配下の画面へのリンク', () => {
  it('実装済みの画面がすべて行き先に並んでいる', () => {
    const linked = [...PROJECT_SECTIONS.map((s) => s.key)].sort()

    expect(linked).toEqual(implementedSections())
  })

  it('行き先が実装済みの画面だけを指している', () => {
    const pages = new Set(implementedSections())

    expect(PROJECT_SECTIONS.filter((s) => !pages.has(s.key))).toEqual([])
  })

  it('並び順は制作の流れに沿っている', () => {
    // 曲を登録してから割る。割ってから生成する。生成してから並べる。並べてから書き出す。
    expect(PROJECT_SECTIONS.map((s) => s.key)).toEqual([
      'music',
      'storyboard',
      'shots',
      'timeline',
      'render',
      'settings',
    ])
  })

  it('すべての行き先にラベルがある', () => {
    expect(PROJECT_SECTIONS.every((s) => s.label.length > 0)).toBe(true)
  })

  it('行き先が重複していない', () => {
    const keys = PROJECT_SECTIONS.map((s) => s.key)

    expect(new Set(keys).size).toBe(keys.length)
  })

  /** 旧 URL を経由しない（PHASE 7.1）。行き先はワークベンチの該当タブ・ダイアログ。 */
  it.each(PROJECT_SECTIONS)('$key のリンクがワークベンチを直接指す', ({ key }) => {
    expect(projectSectionHref(projectId, key)).toBe(legacySectionHref(projectId, key))
    expect(projectSectionHref(projectId, key).startsWith(`/projects/${PROJECT_ID}?`)).toBe(true)
  })

  it('ID をエスケープする', () => {
    expect(projectSectionHref('a/b' as ProjectId, 'shots')).toBe('/projects/a%2Fb?side=shots')
  })
})
