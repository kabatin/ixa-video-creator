import type { DuplicateProjectRequest, Project } from '@ixa/domain'
import type { ProjectDuplicationDeps } from './deps.js'
import { readDuplicationSource } from './read-source.js'
import { writeSnapshot, type WrittenProject } from './write-snapshot.js'

/**
 * 作品を複製する（制作者 2026-10-04「持って行きたいところだけ持っていけるようにすると超便利」。ADR-0037）。
 *
 * 1. 元を全部読む（書く前に。読みながら書くと、途中で失敗したとき何を写したか分からない）
 * 2. 新しい作品を作り、選んだものを写す（`writeSnapshot`。同梱の見本も同じ書き方をする。ADR-0067）
 * 3. **途中で失敗したら、作りかけの新しい作品を消してから投げる**（半分だけ写した作品を残さない）
 */
export type DuplicatedProject = WrittenProject

export const duplicateProject = async (
  deps: ProjectDuplicationDeps,
  source: Project,
  request: DuplicateProjectRequest,
): Promise<DuplicatedProject> => {
  const items = new Set(request.items)
  const snapshot = await readDuplicationSource(deps, source, items)
  return writeSnapshot(deps, snapshot, {
    name: request.name,
    items,
    failure: {
      error: '作品を複製できませんでした',
      log: '作品の複製に失敗したので、作りかけの作品を消します',
      context: { sourceProjectId: source.id },
    },
  })
}
