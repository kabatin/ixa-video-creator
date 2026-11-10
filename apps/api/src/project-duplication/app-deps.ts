import type { ProjectId } from '@ixa/domain'
import type { AppDeps } from '../app.js'
import type { ProjectDuplicationDeps } from './deps.js'

/**
 * アプリの依存から、作品の書き手（複製と同梱の見本。ADR-0037・0067）が使う口を組む。
 * 2 つの口が同じ組み方を使う（片方だけ口を足して、見本だけ声を写さない、を起こさない）。
 */
export const duplicationDepsFromApp = (
  deps: AppDeps,
  syncDialogueTelops: (projectId: ProjectId) => Promise<void>,
): ProjectDuplicationDeps => {
  const { narration, motion } = deps
  return {
    projects: deps.projects,
    scripts: deps.scripts,
    musicTracks: deps.musicTracks,
    musicAnalyses: deps.musicAnalyses,
    characters: deps.characters,
    looks: deps.looks,
    locations: deps.locations,
    brandAssets: deps.brandAssets,
    textStyles: deps.textStyles,
    timelineClips: deps.timelineClips,
    sequences: deps.sequences,
    shots: deps.shots,
    shotCharacters: deps.shotCharacters,
    shotReferences: deps.shotReferences,
    takes: deps.takes,
    transitions: deps.transitions,
    syncDialogueTelops,
    // 声とナレーション（ADR-0038）。繋いでいない環境では持っていけない。
    ...(narration === undefined
      ? {}
      : { voices: narration.voices, narrationLines: narration.lines, narrationTakes: narration.takes }),
    // 動きの分析（ADR-0054 追記）。Take を写すなら分析も写す。
    ...(motion === undefined ? {} : { motionAnalyses: motion.analyses }),
    logger: deps.logger,
  }
}
