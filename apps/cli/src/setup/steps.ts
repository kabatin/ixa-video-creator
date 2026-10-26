import { configProblems } from '@ixa/config'
import { applyMigrations, ensureDefaultWorkspace, fillEmptyEnvValue, listWorkspaces, pendingMigrations, readMigrationJournal } from '@ixa/db'
import { FOREIGN_INFRA_FIX, inspectContainer } from '../checks/db.js'
import { gatherTools, judgeTools } from '../checks/tools.js'
import {
  composeProblems,
  composeSettingsOf,
  composeUpArgs,
  composeUpCommand,
  infraOwnerOf,
  infraSharedOf,
  type ComposeSettings,
  type ContainerState,
} from '../lib/compose.js'
import { appendEnvLine, isBlank, parseEnvFile, type EnvValues } from '../lib/env-file.js'
import type { RepoPaths } from '../lib/repo.js'
import type { System } from '../system.js'
import type { StepResult } from '../types.js'
import { infraAction, infraSettled, signingSecretAction, workspaceAction } from './decide.js'

/**
 * setup の各手順（ADR-0063）。どれも「済み」なら何もせず `already` を返す（何度実行しても壊れない）。
 * **入れる・決める・払うのは人**：道具は入れ方を出して止まる。値の入った `.env` の行は書き換えない。
 */

export type SetupContext = {
  readonly system: System
  readonly repo: RepoPaths
  /** 途中の質問に「はい」で答える（人の同意が要る手順は飛ばして「要る」と返す）。 */
  readonly yes: boolean
}

const DOCKER_WAIT_MS = 90_000
const INFRA_WAIT_MS = 120_000
const POLL_MS = 2000

const waitFor = async (system: System, timeoutMs: number, probe: () => Promise<boolean>): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  const loop = async (): Promise<boolean> => {
    if (await probe()) return true
    if (Date.now() >= deadline) return false
    await system.sleep(POLL_MS)
    return loop()
  }
  return loop()
}

const dockerRunning = async (system: System): Promise<boolean> => {
  const info = await system.run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 10_000 })
  return info.kind === 'completed' && info.exitCode === 0
}

/** Docker Desktop が入っていて止まっているときだけ、聞いて（--yes なら聞かずに）起動する。 */
const startDockerIfAllowed = async (ctx: SetupContext): Promise<boolean> => {
  const allowed = ctx.yes || (await ctx.system.confirm('Docker Desktop が止まっています。起動しますか'))
  if (!allowed) return false
  ctx.system.progress('Docker Desktop を起動しています（1 分ほどかかります）…')
  await ctx.system.run('open', ['-a', 'Docker'], { timeoutMs: 10_000 })
  return waitFor(ctx.system, DOCKER_WAIT_MS, () => dockerRunning(ctx.system))
}

/** 1. 道具。足りなければ入れ方を出して止まる（入れない）。 */
export const toolsStep = async (ctx: SetupContext, expectedPnpm: string | null): Promise<readonly StepResult[]> => {
  const first = judgeTools(await gatherTools(ctx.system, expectedPnpm))
  const dockerDown = first.some((r) => r.id === 'tools.docker-running' && r.level === 'fail')
  const results = dockerDown && (await startDockerIfAllowed(ctx)) ? judgeTools(await gatherTools(ctx.system, expectedPnpm)) : first
  const failures = results.filter((r) => r.level === 'fail')
  if (failures.length === 0) return [{ id: 'tools', status: 'already', message: '道具は揃っています' }]
  return failures.map((r) => ({
    id: r.id,
    status: r.fix?.needsHuman === true ? 'needs_human' : 'failed',
    message: r.message,
    ...(r.fix === undefined ? {} : { fix: r.fix }),
    ...(r.docs === undefined ? {} : { docs: r.docs }),
  }))
}

/** 2. `.env` が無ければ `.env.example` から作る。 */
export const envFileStep = async ({ system, repo }: SetupContext): Promise<StepResult> => {
  if ((await system.readText(repo.env)) !== null) return { id: 'env.file', status: 'already', message: '.env があります' }
  const example = await system.readText(repo.envExample)
  if (example === null) return { id: 'env.file', status: 'failed', message: '.env.example がありません（clone が壊れています）' }
  await system.writeText(repo.env, example)
  return { id: 'env.file', status: 'done', message: '.env を .env.example から作りました（既定は課金しない設定）' }
}

/** 3. 署名の鍵が空なら作って入れる（値は表示しない）。 */
export const signingSecretStep = async ({ system, repo }: SetupContext): Promise<StepResult> => {
  const id = 'env.signing-secret'
  const content = (await system.readText(repo.env)) ?? ''
  const action = signingSecretAction(content)
  if (action === 'already') return { id, status: 'already', message: '署名の鍵（STORAGE_SIGNING_SECRET）は入っています' }
  const secret = system.randomHex(32)
  const next =
    action === 'fill'
      ? (fillEmptyEnvValue(content, 'STORAGE_SIGNING_SECRET', secret) ?? appendEnvLine(content, 'STORAGE_SIGNING_SECRET', secret))
      : appendEnvLine(content, 'STORAGE_SIGNING_SECRET', secret)
  await system.writeText(repo.env, next)
  return { id, status: 'done', message: '署名の鍵（STORAGE_SIGNING_SECRET）を作って .env に入れました' }
}

/** 4. 設定の検査。人が決める問題（課金の鍵など）が残っていれば止まる。 */
export const envValidStep = (env: EnvValues): StepResult => {
  const problems = [...configProblems(env), ...composeProblems(env)]
  return problems.length === 0
    ? { id: 'env.valid', status: 'already', message: '設定の検査を通りました' }
    : {
        id: 'env.valid',
        status: 'needs_human',
        message: `設定に問題があります: ${problems.join(' / ')}`,
        fix: { hint: '.env の書いた名前を直す。課金の鍵を入れるかは制作者に聞く', needsHuman: true },
        docs: 'INSTALL.md#設定',
      }
}

const reachable = async (system: System, env: EnvValues) => ({
  postgres: !isBlank(env, 'DATABASE_URL') && (await canConnect(system, env['DATABASE_URL'] ?? '')),
  redis: !isBlank(env, 'REDIS_URL') && (await system.redisPing(env['REDIS_URL'] ?? '', 3000)) === true,
})

const canConnect = async (system: System, url: string): Promise<boolean> => {
  try {
    await system.withDb(url, (db) => db.execute('select 1'))
    return true
  } catch {
    return false
  }
}

type ContainerPair = readonly [ContainerState, ContainerState]

const containerStates = async (system: System, compose: ComposeSettings): Promise<ContainerPair> => {
  const [p, r] = await Promise.all([
    inspectContainer(system, compose.postgresContainer),
    inspectContainer(system, compose.redisContainer),
  ])
  return [p.state, r.state]
}

/** 同じ名前のコンテナが別の clone のもの。そのまま進むと、その clone の DB に更新や初期データを書く。 */
const foreignInfra = async (system: System, compose: ComposeSettings, repo: RepoPaths, env: EnvValues): Promise<StepResult | null> => {
  const infos = await Promise.all([
    inspectContainer(system, compose.postgresContainer),
    inspectContainer(system, compose.redisContainer),
  ])
  const owner = infraOwnerOf(infos, repo.root)
  if (owner.kind !== 'other' || infraSharedOf(env)) return null
  return {
    id: 'infra',
    status: 'needs_human',
    message: `${compose.postgresContainer}・${compose.redisContainer} は別の場所の ixa（${owner.dir}）のものです。このまま進むとその DB を使います`,
    fix: FOREIGN_INFRA_FIX,
    docs: 'INSTALL.md#2-つ目の-clone',
  }
}

const composeUp = async (system: System, compose: ComposeSettings, repo: RepoPaths): Promise<StepResult | null> => {
  system.progress('postgres・redis を起動しています…')
  const up = await system.run('docker', composeUpArgs(compose, repo), { cwd: repo.root, timeoutMs: 300_000 })
  if (up.kind === 'completed' && up.exitCode === 0) return null
  const detail = up.kind === 'completed' ? up.stderr.trim().split('\n').slice(-2).join(' ') : up.kind
  return {
    id: 'infra',
    status: 'failed',
    message: `Docker で起動できませんでした（${detail}）`,
    fix: { hint: 'Docker Desktop が動いているか、ポートが空いているかを見る', command: composeUpCommand(compose), needsHuman: false },
    docs: 'INSTALL.md#docker',
  }
}

/** 5. postgres・redis を Docker で起動し、使えるまで待つ。 */
export const infraStep = async ({ system, repo }: SetupContext, env: EnvValues): Promise<StepResult> => {
  const id = 'infra'
  // update の 2 段目は設定の検査を通らずにここへ来るので、名前の形はここでも止める。
  const badNames = composeProblems(env)
  if (badNames.length > 0) {
    return { id, status: 'needs_human', message: `Docker の名前の設定に問題があります: ${badNames.join(' / ')}`, fix: FOREIGN_INFRA_FIX, docs: 'INSTALL.md#2-つ目の-clone' }
  }
  const compose = composeSettingsOf(env)
  const foreign = await foreignInfra(system, compose, repo, env)
  if (foreign !== null) return foreign
  const [postgres, redis] = await containerStates(system, compose)
  const action = infraAction(postgres, redis, await reachable(system, env))
  if (action === 'already') return { id, status: 'already', message: 'postgres・redis は動いています' }
  if (action === 'external') return { id, status: 'already', message: 'postgres・redis は Docker の外で動いています（触りません）' }
  const upFailed = action === 'start' ? await composeUp(system, compose, repo) : null
  if (upFailed !== null) return upFailed
  const settled = await waitFor(system, INFRA_WAIT_MS, async () => infraSettled(...(await containerStates(system, compose))) !== 'pending')
  const [p, r] = await containerStates(system, compose)
  return settled && infraSettled(p, r) === 'ready'
    ? { id, status: 'done', message: 'postgres・redis を起動しました' }
    : {
        id,
        status: 'failed',
        message: `postgres・redis が使えるようになりません（postgres: ${p} / redis: ${r}）`,
        fix: { hint: 'コンテナのログを見る', command: `docker logs ${compose.postgresContainer}`, needsHuman: false },
        docs: 'INSTALL.md#docker',
      }
}

/** 6. DB の更新を当てる。 */
export const migrateStep = async ({ system }: SetupContext, env: EnvValues): Promise<StepResult> => {
  const id = 'db.migrate'
  const journal = await readMigrationJournal()
  const url = env['DATABASE_URL'] ?? ''
  const pending = await system.withDb(url, (db) => pendingMigrations(db, journal))
  if (pending.length === 0) return { id, status: 'already', message: 'DB の更新は全部当たっています' }
  system.progress(`DB の更新を ${String(pending.length)} 本当てています…`)
  await system.withDb(url, (db) => applyMigrations(db))
  return { id, status: 'done', message: `DB の更新を ${String(pending.length)} 本当てました（${pending.slice(-3).join(', ')}${pending.length > 3 ? ' ほか' : ''}）` }
}

/** 7. 初期データ（ワークスペース）。ID を `.env` の空欄に書く（値があれば書き換えない）。 */
export const seedStep = async ({ system, repo }: SetupContext, env: EnvValues): Promise<StepResult> => {
  const id = 'db.seed'
  const url = env['DATABASE_URL'] ?? ''
  const envId = isBlank(env, 'NEXT_PUBLIC_WORKSPACE_ID') ? null : (env['NEXT_PUBLIC_WORKSPACE_ID'] ?? '').trim()
  const ids = await system.withDb(url, async (db) => (await listWorkspaces(db)).map((w) => w.id))
  const action = workspaceAction(envId, ids)
  if (action === 'already') return { id, status: 'already', message: 'ワークスペースがあり、.env の ID と合っています' }
  if (action === 'mismatch') {
    return {
      id,
      status: 'needs_human',
      message: '.env の NEXT_PUBLIC_WORKSPACE_ID がこの DB にありません（別の DB の ID かもしれません。書き換えません）',
      fix: { hint: 'どちらの DB を使うか制作者に確かめ、.env の ID を直す', needsHuman: true },
      docs: 'INSTALL.md#db',
    }
  }
  const workspace = await system.withDb(url, (db) => ensureDefaultWorkspace(db))
  const content = (await system.readText(repo.env)) ?? ''
  const next = fillEmptyEnvValue(content, 'NEXT_PUBLIC_WORKSPACE_ID', workspace.id) ?? appendEnvLine(content, 'NEXT_PUBLIC_WORKSPACE_ID', workspace.id)
  await system.writeText(repo.env, next)
  return { id, status: 'done', message: 'ワークスペースを用意し、ID を .env の NEXT_PUBLIC_WORKSPACE_ID に書きました' }
}

/** 8. 音の解析の依存（`uv sync`）。揃っていれば何もしない。 */
export const audioDepsStep = async ({ system, repo }: SetupContext): Promise<StepResult> => {
  const id = 'audio.deps'
  const check = await system.run('uv', ['sync', '--directory', repo.audioDir, '--locked', '--check'], { timeoutMs: 60_000 })
  if (check.kind === 'completed' && check.exitCode === 0 && (await system.exists(repo.audioVenv))) {
    return { id, status: 'already', message: '音の解析の依存は揃っています' }
  }
  system.progress('音の解析の依存を入れています（uv sync。初回は数分）…')
  const sync = await system.run('uv', ['sync', '--directory', repo.audioDir, '--locked'], { inherit: 'to-stderr', timeoutMs: 900_000 })
  return sync.kind === 'completed' && sync.exitCode === 0
    ? { id, status: 'done', message: '音の解析の依存を入れました（uv sync）' }
    : {
        id,
        status: 'failed',
        message: '音の解析の依存を入れられませんでした',
        fix: { hint: '出力のエラーを見る（ネットにつながっているか）', command: 'uv sync --directory apps/audio --locked', needsHuman: false },
        docs: 'INSTALL.md#任意',
      }
}

export const readEnv = async (system: System, repo: RepoPaths): Promise<EnvValues> =>
  parseEnvFile((await system.readText(repo.env)) ?? '')
