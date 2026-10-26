import { FOREIGN_INFRA_FIX, infraInfos } from '../checks/containers.js'
import { composeProblems, infraOwnerOf, infraSharedOf, type InfraOwner } from '../lib/compose.js'
import type { EnvValues } from '../lib/env-file.js'
import type { RepoPaths } from '../lib/repo.js'
import type { System } from '../system.js'
import type { StepResult } from '../types.js'

/**
 * 「この clone の DB か」の見張り（ADR-0063）。**DB に書く手順（起動・DB の更新・初期データ）と infra up/down は、
 * どれも最初にこれを通す。**
 *
 * 見るもの:
 * - 名前（`<prefix>-postgres`・`<prefix>-redis`）のコンテナを起こした compose の場所
 * - `.env` の URL が指すポートを公開しているコンテナの compose の場所（名前を替えてもポートが同じなら、つながる先はそちら）
 * 場所はシンボリックリンクをたどって比べる。
 */

export const infraOwner = async (system: System, env: EnvValues, repo: RepoPaths): Promise<InfraOwner> =>
  infraOwnerOf(await infraInfos(system, env), repo.root)

/** 止める理由（無ければ null）。id は呼んだ手順の名前にする。 */
export const infraGuard = async (system: System, env: EnvValues, repo: RepoPaths, id: string): Promise<StepResult | null> => {
  const problems = composeProblems(env)
  if (problems.length > 0) {
    return {
      id,
      status: 'needs_human',
      message: `Docker の名前・ポートの設定に問題があります: ${problems.join(' / ')}`,
      fix: FOREIGN_INFRA_FIX,
      docs: 'INSTALL.md#2-つ目の-clone',
    }
  }
  const owner = await infraOwner(system, env, repo)
  if (owner.kind !== 'other' || infraSharedOf(env)) return null
  return {
    id,
    status: 'needs_human',
    message: `つなぐ先の postgres・redis は別の場所の ixa（${owner.dir}）のものです。このまま進むとその DB を使います`,
    fix: FOREIGN_INFRA_FIX,
    docs: 'INSTALL.md#2-つ目の-clone',
  }
}
