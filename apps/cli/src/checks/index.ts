import { parseEnvFile } from '../lib/env-file.js'
import { expectedPnpmVersion, parseRootPackage, type RepoPaths } from '../lib/repo.js'
import type { System } from '../system.js'
import type { CheckGroup, CheckResult } from '../types.js'
import { gatherDb, judgeDb } from './db.js'
import { gatherEnv, judgeEnv } from './env.js'
import { gatherLocalAi, judgeLocalAi } from './local-ai.js'
import { gatherOptional, judgeOptional } from './optional.js'
import { gatherRuntime, judgeRuntime } from './runtime.js'
import { pendingCheck, readMarker } from '../update/marker.js'
import { gatherTools, judgeTools } from './tools.js'

/** 表示の順番（道具 → 設定 → DB → 動いているもの → 手元の AI → 任意）。 */
export const GROUP_ORDER: readonly CheckGroup[] = ['tools', 'env', 'db', 'runtime', 'local-ai', 'optional']

const byGroup = (results: readonly CheckResult[]): readonly CheckResult[] =>
  GROUP_ORDER.flatMap((group) => results.filter((r) => r.group === group))

/** 全部を点検する。**読むだけで何も書かない**（doctor は生きている環境でも安全に回せる）。 */
export const runChecks = async (system: System, repo: RepoPaths): Promise<readonly CheckResult[]> => {
  const rootPackage = await system.readText(repo.rootPackage)
  if (rootPackage === null) throw new Error(`${repo.rootPackage} がありません（ixa の直下ではないようです）`)
  const expectedPnpm = expectedPnpmVersion(parseRootPackage(rootPackage))
  const envFacts = await gatherEnv(system, repo)
  const env = envFacts.envContent === null ? {} : parseEnvFile(envFacts.envContent)
  const [tools, db, runtime, localAi, optional] = await Promise.all([
    gatherTools(system, expectedPnpm),
    gatherDb(system, env, repo.root),
    gatherRuntime(system, env, repo.root),
    gatherLocalAi(system, env),
    gatherOptional(system, env, repo),
  ])
  return byGroup([
    ...judgeTools(tools),
    pendingCheck(await readMarker(system, repo)),
    ...judgeEnv(envFacts),
    ...judgeDb(db),
    ...judgeRuntime(runtime),
    ...judgeLocalAi(localAi),
    ...judgeOptional(optional),
  ])
}
