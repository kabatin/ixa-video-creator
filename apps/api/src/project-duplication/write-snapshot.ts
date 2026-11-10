import { duplicationNotes, type DuplicationItem, type Project, type ProjectDemoKey } from '@ixa/domain'
import type { ProjectDuplicationDeps } from './deps.js'
import type { DuplicationSource } from './read-source.js'
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
 * 読んだもの（`DuplicationSource`）を新しい作品に書く。作品の複製（ADR-0037）と同梱の見本（ADR-0067）が使う。
 *
 * - 新しい作品は `snapshot.project` の作業場所に作る（見本は呼ぶ側が、入れる先の作業場所に替えて渡す）
 * - **途中で失敗したら、作りかけの新しい作品を消してから投げる**（半分だけ写した作品を残さない）。
 *   リポジトリをまたぐトランザクションが無いため、消すことで戻す
 */

export type WrittenProject = {
  readonly project: Project
  /** 外したものの知らせ（画面にそのまま出す。ID を含めない）。 */
  readonly notes: readonly string[]
}

export type WriteSnapshotOptions = {
  readonly name: string
  readonly items: ReadonlySet<DuplicationItem>
  /** 同梱の見本の印（見本を入れるときだけ）。 */
  readonly demoKey?: ProjectDemoKey
  /** 失敗したときの知らせ。`error` は投げる例外の文、`log` はログの文、`context` はログに添えるもの。 */
  readonly failure: {
    readonly error: string
    readonly log: string
    readonly context: Readonly<Record<string, unknown>>
  }
}

export const writeSnapshot = async (
  deps: ProjectDuplicationDeps,
  snapshot: DuplicationSource,
  options: WriteSnapshotOptions,
): Promise<WrittenProject> => {
  const { items } = options
  const project = await createDuplicateProject(deps, snapshot.project, options.name, items, options.demoKey)
  try {
    await writeConcept(deps, project, snapshot.concept)
    await writeMusic(deps, project, snapshot)
    const library = await writeLibrary(deps, project, snapshot)
    // 見た目 → 声 → ナレーション → Shot → テロップ の順。声はテロップの見た目を指し、テロップはナレーションの行と
    // （セリフの字幕は）Shot を指す（ADR-0061）。
    const styles = await writeTextStyles(deps, project, snapshot)
    const { narrationLines, characterVoicesDropped } = await writeNarration(deps, project, snapshot, items, {
      characters: library.characters,
      styles,
    })
    const { castDropped, locationDropped, dialogueLinesDropped, dialogueShotMap } = await writeShots(deps, project, snapshot, items, library)
    const { lyricLinksDropped, narrationLinksDropped } = await writeClips(deps, project, snapshot, items, {
      styles,
      narrationLines,
      shots: dialogueShotMap,
    })
    // セリフの字幕は写した先の Shot から作り直す（写さなかった行の字幕を消し、残った行は時刻と見た目を引き継ぐ）。
    await deps.syncDialogueTelops(project.id)
    return {
      project,
      notes: duplicationNotes({
        castDropped,
        locationDropped,
        lyricLinksDropped,
        narrationLinksDropped,
        characterVoicesDropped,
        dialogueLinesDropped,
      }),
    }
  } catch (error) {
    deps.logger.error({ err: error, ...options.failure.context, projectId: project.id }, options.failure.log)
    await deps.projects.softDelete(project.id).catch((cleanupError: unknown) => {
      deps.logger.error({ err: cleanupError, projectId: project.id }, '作りかけの作品を消せませんでした')
    })
    throw new Error(options.failure.error, { cause: error })
  }
}
