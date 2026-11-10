import { DUPLICATION_ITEMS } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { duplicateProject } from '../project-duplication/duplicate.js'
import { baseAppDeps } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * 作品の複製の後片付け（ADR-0037）。作った直後に作成の入力に無い項目（避けたいもの・歌詞など）を入れる書き込みが
 * 落ちても、作りかけの作品を残さない（前はこの書き込みが後片付けの外にあり、半端な作品が一覧に残った）。
 */
describe('複製: 作った直後の直しが落ちたとき', () => {
  it('作りかけの作品を消してから投げる', async () => {
    const source = aProject({ name: '元の作品', lyrics: '一行目' })
    const projects = createInMemoryProjectRepository([source])
    const deps = {
      ...baseAppDeps(),
      projects: { ...projects, update: () => Promise.reject(new Error('書けませんでした')) },
      syncDialogueTelops: () => Promise.resolve(),
      logger: createLogger('silent'),
    }
    await expect(duplicateProject(deps, source, { name: '写し', items: [...DUPLICATION_ITEMS] })).rejects.toThrow('作品を複製できませんでした')
    expect(projects.snapshot()).toEqual([source])
  })
})
