import { ProjectId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { PROJECT_ID } from '@/__tests__/fixtures'
import { PROJECT_SECTIONS, projectSectionHref } from '@/lib/project-links'

const projectId = ProjectId.parse(PROJECT_ID)

describe('Project 配下の画面へのリンク', () => {
  /**
   * 以前ストーリーボードとタイムラインがどこからもリンクされておらず、
   * URL を直接打つしか到達手段が無かった。実装したのに使えない画面を作らないため、
   * 「画面がある」と「そこへ行ける」を突き合わせる。
   */
  it('実装済みの画面がすべて行き先に並んでいる', () => {
    expect(PROJECT_SECTIONS.map((s) => s.key)).toEqual(['shots', 'storyboard', 'timeline'])
  })

  it('すべての行き先にラベルがある', () => {
    expect(PROJECT_SECTIONS.every((s) => s.label.length > 0)).toBe(true)
  })

  it('行き先が重複していない', () => {
    const keys = PROJECT_SECTIONS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it.each(PROJECT_SECTIONS)('$key のリンクが Project 配下を指す', ({ key }) => {
    expect(projectSectionHref(projectId, key)).toBe(`/projects/${PROJECT_ID}/${key}`)
  })

  it('ID をエスケープする', () => {
    const href = projectSectionHref('a/b' as ProjectId, 'shots')
    expect(href).toBe('/projects/a%2Fb/shots')
  })
})
