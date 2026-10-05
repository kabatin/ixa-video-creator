import { syncNarrationTelops } from '@ixa/generation'
import type { NarrationLineId, ProjectId } from '@ixa/domain'
import type { NarrationDeps } from './deps.js'

/**
 * ナレーションのテロップを作り直す（ADR-0038）。規則は `@ixa/generation` の 1 か所（worker も同じものを呼ぶ）。
 * `restyle` は、話す声・声の見た目を変えた行（その行だけ声の見た目で選び直す。ほかは今の見た目を引き継ぐ）。
 */
export const syncTelops = async (
  deps: NarrationDeps,
  projectId: ProjectId,
  restyle: readonly NarrationLineId[] = [],
): Promise<void> => {
  await syncNarrationTelops(deps, projectId, { restyle })
}

/** 手でナレーションのテロップを消したら、その行を「テロップなし」にする（作り直しで付け直さない。残りの枚も消える）。 */
export const turnOffLineTelop = async (deps: NarrationDeps, lineId: NarrationLineId): Promise<void> => {
  const line = await deps.lines.findById(lineId)
  if (line === null) return
  await deps.lines.update(lineId, { telop: false })
  await syncTelops(deps, line.projectId)
}
