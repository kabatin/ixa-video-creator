import { describe, expect, it } from 'vitest'
import { ProjectId, newId } from '../common/ids.js'
import { ProjectEvent, SHOT_LIST_EVENT_TYPES } from '../events/project-event.js'

/** 作品を書き換えた（MCP・別の画面・エージェント）。開いている画面が読み直す合図。 */
describe('project.edited', () => {
  const base = { type: 'project.edited', projectId: newId(ProjectId), at: new Date().toISOString() }

  it('書いた画面の印（origin）を持つ。無ければ null', () => {
    expect(ProjectEvent.parse({ ...base, origin: 'tab_01' })).toEqual({ ...base, origin: 'tab_01' })
    expect(ProjectEvent.parse(base)).toEqual({ ...base, origin: null })
  })

  it('印は短い英数字だけ。長すぎる・記号入り・空は受け付けない', () => {
    expect(ProjectEvent.safeParse({ ...base, origin: 'a'.repeat(65) }).success).toBe(false)
    expect(ProjectEvent.safeParse({ ...base, origin: 'tab 01' }).success).toBe(false)
    expect(ProjectEvent.safeParse({ ...base, origin: '' }).success).toBe(false)
  })

  it('画面が受け取る出来事に入っている', () => {
    expect(SHOT_LIST_EVENT_TYPES).toContain('project.edited')
  })
})
