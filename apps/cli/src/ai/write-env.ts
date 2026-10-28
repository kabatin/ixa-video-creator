import { configProblems } from '@ixa/config'
import { parseEnvFile } from '../lib/env-file.js'
import type { RepoPaths } from '../lib/repo.js'
import type { System } from '../system.js'
import type { StepResult } from '../types.js'
import { applyEnvChanges, type EnvChanges } from './env-merge.js'

/**
 * `ai install | connect` の答えを `.env` に書く手順（ADR-0064）。文に入れるのは**名前だけ**。
 * 値の入った接続先を替えるのは `--overwrite-env` か、端末で「はい」と答えたときだけ（`--yes` では替えない。
 * `--yes` はライセンスとダウンロードの質問を飛ばすだけで、別の Mac を指す URL を黙って 127.0.0.1 にしない）。
 * 替えてよいと言われなければ**何も書かない**（一覧だけ書くと、別の Mac の合言葉のまま手元を指すことがある）。
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

const keptStep = (conflicts: readonly string[], retry: string): StepResult => ({
  id: 'ai.env.kept',
  status: 'needs_human',
  message: `値が入っているので .env を書きませんでした: ${conflicts.join('・')}`,
  fix: { hint: '替えてよいか制作者に確かめ、--overwrite-env を付けてもう一度', command: `${retry} --overwrite-env`, needsHuman: true },
  docs: DOCS,
})

export const writeEnvStep = async (
  system: System,
  repo: RepoPaths,
  changes: EnvChanges,
  overwrite: boolean,
  retry: string,
): Promise<readonly StepResult[]> => {
  const content = await system.readText(repo.env)
  if (content === null) return [NO_ENV_STEP]
  const first = applyEnvChanges(content, changes, overwrite)
  if (first.conflicts.length > 0) {
    const allowed = await system.confirm(`.env の ${first.conflicts.join('・')} にはもう別の値が入っています。書き換えますか`)
    if (!allowed) return [keptStep(first.conflicts, retry)]
  }
  const applied = first.conflicts.length > 0 ? applyEnvChanges(content, changes, true) : first
  const problems = addedProblems(content, applied.content)
  if (problems.length > 0) {
    return [{ id: 'ai.env', status: 'failed', message: `.env に書くと設定が崩れるので書きませんでした: ${problems.join('／')}`, docs: DOCS }]
  }
  if (applied.changed.length > 0) await system.writeText(repo.env, applied.content)
  return [
    applied.changed.length > 0
      ? { id: 'ai.env', status: 'done', message: `.env に書きました: ${applied.changed.join('・')}` }
      : { id: 'ai.env', status: 'already', message: '.env はもう揃っています' },
  ]
}
