import { configProblems } from '@ixa/config'
import { parseEnvFile } from '../lib/env-file.js'
import type { RepoPaths } from '../lib/repo.js'
import type { System } from '../system.js'
import type { StepResult } from '../types.js'
import { applyEnvChanges, type EnvChanges } from './env-merge.js'

/**
 * `ai install | connect` の答えを `.env` に書く手順（ADR-0064）。文に入れるのは**名前だけ**。
 * 値の入った接続先を替えるのは `--yes` か、端末で「はい」と答えたときだけ。
 * 書くと設定の問題が新しく増えるなら書かない（合言葉の形などは `configProblems` が唯一の正）。
 */

const DOCS = 'INSTALL.md#手元の生成-ai'

export const NO_ENV_STEP: StepResult = {
  id: 'ai.env.missing',
  status: 'failed',
  message: '.env がありません',
  fix: { hint: '先に導入を済ませる', command: 'pnpm ixa setup', needsHuman: false },
}

/** 書いた後で新しく増えた設定の問題（純粋）。 */
export const addedProblems = (before: string, after: string): readonly string[] => {
  const old = new Set(configProblems(parseEnvFile(before)))
  return configProblems(parseEnvFile(after)).filter((problem) => !old.has(problem))
}

export const writeEnvStep = async (
  system: System,
  repo: RepoPaths,
  changes: EnvChanges,
  yes: boolean,
  retry: string,
): Promise<readonly StepResult[]> => {
  const content = await system.readText(repo.env)
  if (content === null) return [NO_ENV_STEP]
  const first = applyEnvChanges(content, changes, yes)
  const askAgain =
    first.conflicts.length > 0 &&
    !yes &&
    (await system.confirm(`.env の ${first.conflicts.join('・')} にはもう別の値が入っています。書き換えますか`))
  const applied = askAgain ? applyEnvChanges(content, changes, true) : first
  const problems = addedProblems(content, applied.content)
  if (problems.length > 0) {
    return [{ id: 'ai.env', status: 'failed', message: `.env に書くと設定が崩れるので書きませんでした: ${problems.join('／')}`, docs: DOCS }]
  }
  if (applied.changed.length > 0) await system.writeText(repo.env, applied.content)
  const written: StepResult =
    applied.changed.length > 0
      ? { id: 'ai.env', status: 'done', message: `.env に書きました: ${applied.changed.join('・')}` }
      : { id: 'ai.env', status: 'already', message: '.env はもう揃っています' }
  const kept: readonly StepResult[] =
    applied.conflicts.length === 0
      ? []
      : [
          {
            id: 'ai.env.kept',
            status: 'needs_human',
            message: `値が入っているので替えませんでした: ${applied.conflicts.join('・')}`,
            fix: { hint: '替えてよいか制作者に確かめ、--yes を付けてもう一度', command: `${retry} --yes`, needsHuman: true },
            docs: DOCS,
          },
        ]
  return [written, ...kept]
}
