import { duplicationNotes, type DuplicateProjectRequest, type Project } from '@ixa/domain'
import type { ProjectDuplicationDeps } from './deps.js'
import { readDuplicationSource } from './read-source.js'
import {
  createDuplicateProject,
  writeClips,
  writeConcept,
  writeLibrary,
  writeMusic,
  writeNarration,
  writeTextStyles,
} from './write-project.js'
import { writeShots } from './write-shots.js'

/**
 * 作品を複製する（制作者 2026-10-04「持って行きたいところだけ持っていけるようにすると超便利」。ADR-0037）。
 *
 * 1. 元を全部読む（書く前に。読みながら書くと、途中で失敗したとき何を写したか分からない）
 * 2. 新しい作品を作り、選んだものを写す
 * 3. **途中で失敗したら、作りかけの新しい作品を消してから投げる**（半分だけ写した作品を残さない）。
 *    リポジトリをまたぐトランザクションが無いため、消すことで戻す
 */
export type DuplicatedProject = {
  readonly project: Project
  /** 外したものの知らせ（画面にそのまま出す。ID を含めない）。 */
  readonly notes: readonly string[]
}

export const duplicateProject = async (
  deps: ProjectDuplicationDeps,
  source: Project,
  request: DuplicateProjectRequest,
): Promise<DuplicatedProject> => {
  const items = new Set(request.items)
  const snapshot = await readDuplicationSource(deps, source, items)
  const project = await createDuplicateProject(deps, source, request.name, items)
  try {
    await writeConcept(deps, project, snapshot.concept)
    await writeMusic(deps, project, snapshot)
    const library = await writeLibrary(deps, project, snapshot)
    // 見た目 → 声 → ナレーション → テロップ の順。声はテロップの見た目を指し、テロップはナレーションの行を指す。
    const styles = await writeTextStyles(deps, project, snapshot)
    const { narrationLines, characterVoicesDropped } = await writeNarration(deps, project, snapshot, items, {
      characters: library.characters,
      styles,
    })
    const { lyricLinksDropped, narrationLinksDropped } = await writeClips(deps, project, snapshot, items, {
      styles,
      narrationLines,
    })
    const { castDropped, locationDropped } = await writeShots(deps, project, snapshot, items, library)
    return {
      project,
      notes: duplicationNotes({
        castDropped,
        locationDropped,
        lyricLinksDropped,
        narrationLinksDropped,
        characterVoicesDropped,
      }),
    }
  } catch (error) {
    deps.logger.error(
      { err: error, sourceProjectId: source.id, projectId: project.id },
      '作品の複製に失敗したので、作りかけの作品を消します',
    )
    await deps.projects.softDelete(project.id).catch((cleanupError: unknown) => {
      deps.logger.error({ err: cleanupError, projectId: project.id }, '作りかけの作品を消せませんでした')
    })
    throw new Error('作品を複製できませんでした', { cause: error })
  }
}
