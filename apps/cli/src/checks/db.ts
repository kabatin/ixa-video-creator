import { listWorkspaces, pendingMigrations, readMigrationJournal } from '@ixa/db'
import {
  composeSettingsOf,
  COMPOSE_UP_COMMAND,
  infraOwnerOf,
  infraSharedOf,
  type ComposeSettings,
  type ContainerState,
  type InfraOwner,
} from '../lib/compose.js'
import { dbErrorReason } from '../lib/db-error.js'
import { isBlank, type EnvValues } from '../lib/env-file.js'
import type { System } from '../system.js'
import type { CheckResult } from '../types.js'
import { FOREIGN_INFRA_FIX, infraInfos, inspectContainer } from './containers.js'

/** DB の点検（postgres・redis が動いているか・誰のものか・つながるか・まだの DB の更新・ワークスペース）。 */

export type DbFacts = {
  readonly compose: ComposeSettings
  readonly postgresContainer: ContainerState
  readonly redisContainer: ContainerState
  /** コンテナを起こした clone。別の clone のものなら DB を共有している。 */
  readonly owner: InfraOwner
  /** `.env` の IXA_COMPOSE_SHARED=true（共有してよいと人が決めた）。 */
  readonly shared: boolean
  /** つながったら true、つながらなければ理由。URL が無ければ null。 */
  readonly postgres: true | string | null
  readonly redis: true | string | null
  /** まだ当てていない更新の名前。つながらなければ null。 */
  readonly pending: readonly string[] | null
  readonly workspaceIds: readonly string[] | null
  /** `.env` の `NEXT_PUBLIC_WORKSPACE_ID`（ID は秘密ではない）。空なら null。 */
  readonly envWorkspaceId: string | null
}

const DOCS = 'INSTALL.md#db'
const SETUP = { hint: 'setup が起動・更新・初期データまでやる', command: 'pnpm ixa setup', needsHuman: false } as const

export const ownerCheck = (owner: InfraOwner, shared: boolean): CheckResult => {
  const id = 'db.infra-owner'
  if (owner.kind !== 'other') return { id, group: 'db', level: 'ok', message: 'postgres・redis はこの clone のものです（またはまだありません）' }
  return shared
    ? { id, group: 'db', level: 'ok', message: `postgres・redis は別の場所の ixa（${owner.dir}）と共有する設定です` }
    : {
        id,
        group: 'db',
        level: 'warn',
        message: `postgres・redis は別の場所の ixa（${owner.dir}）のものです。この clone は同じ DB を使います`,
        fix: FOREIGN_INFRA_FIX,
        docs: 'INSTALL.md#2-つ目の-clone',
      }
}

const containerCheck = (id: string, label: string, state: ContainerState, reachable: boolean): CheckResult => {
  if (state === 'healthy') return { id, group: 'db', level: 'ok', message: `${label} のコンテナが動いています` }
  // Docker 以外（brew の postgres など）で動かしている人は、つながれば良い。
  if (reachable) return { id, group: 'db', level: 'ok', message: `${label} は Docker の外で動いています（つながる）` }
  const why = { missing: 'がありません', stopped: 'が止まっています', starting: 'が起動中です', unhealthy: 'が不調です' }[state]
  return {
    id,
    group: 'db',
    level: state === 'starting' ? 'warn' : 'fail',
    message: `${label} のコンテナ${why}`,
    fix: { hint: 'Docker で起動する', command: COMPOSE_UP_COMMAND, needsHuman: false },
    docs: DOCS,
  }
}

const connectCheck = (id: string, label: string, result: true | string | null): CheckResult => {
  if (result === true) return { id, group: 'db', level: 'ok', message: `${label} につながります` }
  if (result === null) return { id, group: 'db', level: 'skip', message: `${label} の URL が .env に無いので見ません` }
  return { id, group: 'db', level: 'fail', message: `${label} につながりません（${result}）`, fix: SETUP, docs: DOCS }
}

const migrationsCheck = (pending: readonly string[] | null): CheckResult => {
  if (pending === null) return { id: 'db.migrations', group: 'db', level: 'skip', message: 'DB につながらないので見ません' }
  if (pending.length === 0) return { id: 'db.migrations', group: 'db', level: 'ok', message: 'DB の更新は全部当たっています' }
  return {
    id: 'db.migrations',
    group: 'db',
    level: 'fail',
    message: `まだ当てていない DB の更新が ${String(pending.length)} 本あります（${pending.slice(-3).join(', ')}${pending.length > 3 ? ' ほか' : ''}）`,
    fix: { hint: 'DB の更新を当てる', command: 'pnpm ixa setup', needsHuman: false },
    docs: DOCS,
  }
}

const workspaceCheck = (ids: readonly string[] | null, envId: string | null): CheckResult => {
  const id = 'db.workspace'
  if (ids === null) return { id, group: 'db', level: 'skip', message: 'DB につながらないので見ません' }
  if (ids.length === 0) {
    return { id, group: 'db', level: 'fail', message: 'ワークスペースがまだありません', fix: SETUP, docs: DOCS }
  }
  if (envId === null) {
    return {
      id,
      group: 'db',
      level: 'fail',
      message: 'ワークスペースはあるが、.env の NEXT_PUBLIC_WORKSPACE_ID が空です',
      fix: SETUP,
      docs: DOCS,
    }
  }
  return ids.includes(envId)
    ? { id, group: 'db', level: 'ok', message: 'ワークスペースがあり、.env の ID と合っています' }
    : {
        id,
        group: 'db',
        level: 'fail',
        message: '.env の NEXT_PUBLIC_WORKSPACE_ID がこの DB のワークスペースにありません（別の DB の ID かもしれません）',
        fix: { hint: 'どちらの DB を使うか制作者に確かめ、.env の ID を直す（setup は値の入った行を書き換えない）', needsHuman: true },
        docs: DOCS,
      }
}

/** 判定（純粋）。 */
export const judgeDb = (facts: DbFacts): readonly CheckResult[] => [
  containerCheck('db.postgres-container', 'postgres', facts.postgresContainer, facts.postgres === true),
  containerCheck('db.redis-container', 'redis', facts.redisContainer, facts.redis === true),
  ownerCheck(facts.owner, facts.shared),
  connectCheck('db.postgres', 'postgres', facts.postgres),
  connectCheck('db.redis', 'redis', facts.redis),
  migrationsCheck(facts.pending),
  workspaceCheck(facts.workspaceIds, facts.envWorkspaceId),
]

type DbRead = { readonly pending: readonly string[]; readonly workspaceIds: readonly string[] }

const readDb = async (system: System, url: string): Promise<DbRead | string> => {
  try {
    const journal = await readMigrationJournal()
    return await system.withDb(url, async (db) => {
      const pending = await pendingMigrations(db, journal)
      // まだ 1 本も当てていなければ表が無い。ワークスペースは「無い」として扱う。
      const workspaceIds = pending.length > 0 && pending.length === journal.entries.length
        ? []
        : (await listWorkspaces(db)).map((w) => w.id)
      return { pending, workspaceIds }
    })
  } catch (error) {
    // 文に URL（合言葉入り）を入れない。postgres.js の文は接続先を含むことがあるので、code だけ言う。
    return dbErrorReason(error)
  }
}

export const gatherDb = async (system: System, env: EnvValues, repoRoot: string): Promise<DbFacts> => {
  const compose = composeSettingsOf(env)
  const databaseUrl = isBlank(env, 'DATABASE_URL') ? null : (env['DATABASE_URL'] ?? null)
  const redisUrl = isBlank(env, 'REDIS_URL') ? null : (env['REDIS_URL'] ?? null)
  const [postgresInfo, redisInfo, infos, db, redis] = await Promise.all([
    inspectContainer(system, compose.postgresContainer),
    inspectContainer(system, compose.redisContainer),
    infraInfos(system, env),
    databaseUrl === null ? Promise.resolve(null) : readDb(system, databaseUrl),
    redisUrl === null ? Promise.resolve(null) : system.redisPing(redisUrl, 3000),
  ])
  const envId = (env['NEXT_PUBLIC_WORKSPACE_ID'] ?? '').trim()
  return {
    compose,
    postgresContainer: postgresInfo.state,
    redisContainer: redisInfo.state,
    owner: infraOwnerOf(infos, repoRoot),
    shared: infraSharedOf(env),
    postgres: db === null ? null : typeof db === 'string' ? db : true,
    redis,
    pending: db !== null && typeof db !== 'string' ? db.pending : null,
    workspaceIds: db !== null && typeof db !== 'string' ? db.workspaceIds : null,
    envWorkspaceId: envId === '' ? null : envId,
  }
}
