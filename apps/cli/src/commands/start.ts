import type { Options } from '../args.js'
import { devIsRunning, gatherRuntime, judgeRuntime, type RuntimeFacts } from '../checks/runtime.js'
import { parseEnvFile, type EnvValues } from '../lib/env-file.js'
import { WEB_PORT, type RepoPaths } from '../lib/repo.js'
import { formatChecks, formatStep, type Output } from '../printer.js'
import { readEnv } from '../setup/steps.js'
import { buildDecision, parseBuildRecord, publicEnvHashOf, staleReasonText, type BuildRecord } from '../start/build-record.js'
import type { RunResult, System } from '../system.js'
import type { StepResult } from '../types.js'

/**
 * `pnpm ixa start`（ADR-0068）。使う人のための起動。組み立て済みの画面（`next start`）と、
 * 見張らない api・worker・音の解析を `turbo run serve` で起こし、端末につなぐ（Ctrl+C で止まる）。
 *
 * `pnpm dev` は開くたびに組み立て直し、`next dev` はメモリが増えると自分で起動し直す（開発のための形）。
 * 画面はコードか `NEXT_PUBLIC_*` が変わったときだけ組み立て直す（`start/build-record.ts`）。
 */

const WEB_URL = `http://localhost:${String(WEB_PORT)}`
const BUILD_ARGS = ['--filter', '@ixa/web', 'run', 'build:start'] as const
const SERVE_ARGS = ['exec', 'turbo', 'run', 'serve'] as const

const noEnv: StepResult = {
  id: 'start.env',
  status: 'failed',
  message: '.env がありません',
  fix: { hint: '先に導入を済ませる', command: 'pnpm ixa setup', needsHuman: false },
  docs: 'INSTALL.md#設定',
}

/** 止めるまで返らないので、`--json` では起こさない。答えの形は CLI の失敗の形（command・ok・error）に揃える。 */
const JSON_REFUSAL =
  'pnpm ixa start は止めるまで動き続けるため、--json では起動しません。--json を付けずに後ろで起動し、' +
  'pnpm -s ixa doctor --json の runtime.* が ✓ になるまで待ってください'

const exitCodeOf = (result: RunResult): number => (result.kind === 'completed' ? result.exitCode : 1)

const headCommit = async (system: System, repo: RepoPaths): Promise<string | null> => {
  const result = await system.run('git', ['rev-parse', 'HEAD'], { cwd: repo.root, timeoutMs: 10_000 })
  return result.kind === 'completed' && result.exitCode === 0 ? result.stdout.trim() : null
}

/** 今の版と画面の設定。 */
const currentBuildInputs = async (system: System, repo: RepoPaths, env: EnvValues) => {
  const webLocal = parseEnvFile((await system.readText(repo.webEnvLocal)) ?? '')
  return { commit: await headCommit(system, repo), publicEnv: publicEnvHashOf(env, webLocal) }
}

/** ほかのものがポートを使っていれば、起動してから落ちる前に止める（doctor と同じ点検を見せる）。 */
const portConflicts = (facts: RuntimeFacts) =>
  judgeRuntime(facts).filter((r) => r.id.startsWith('runtime.port-') && r.level !== 'ok')

/**
 * 画面を組み立てる。成功したときだけ記録を書く（失敗した記録を残すと、次も壊れた画面を起こす）。
 * 版が分からない（`record` が null）ときは記録を書かない。次も組み立て直す（buildDecision）。
 */
const buildWeb = async (system: System, repo: RepoPaths, out: Output, record: BuildRecord | null): Promise<number> => {
  out.line('画面を本番用に組み立てています。初回は数分かかることがあります（2 回目からは、コードか設定が変わったときだけ）…')
  // 先に前の記録を消す。組み立てが途中で止まると出力先は半端になるので、前の記録で「組み立て済み」と読まない。
  await system.remove(repo.webBuildRecord)
  const code = exitCodeOf(await system.run('pnpm', BUILD_ARGS, { cwd: repo.root, inherit: 'all' }))
  if (code !== 0) {
    out.line('✗ 画面の組み立てに失敗しました（上の出力を見てください）。直してから pnpm ixa start --build')
    return code
  }
  if (record !== null) await system.writeText(repo.webBuildRecord, `${JSON.stringify(record, null, 2)}\n`)
  return 0
}

export const startCommand = async (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  if ((await system.readText(repo.env)) === null) {
    out.line(formatStep(noEnv))
    out.result({ command: 'start', ok: false, steps: [noEnv] })
    return 1
  }
  const env = await readEnv(system, repo)
  const runtime = await gatherRuntime(system, env, repo.root)
  if (devIsRunning(runtime)) {
    out.line(`✓ この clone の ixa はもう動いています: ${WEB_URL}（止めるなら起動した端末で Ctrl+C）`)
    out.result({ command: 'start', ok: true, running: true, url: WEB_URL })
    return 0
  }
  const conflicts = portConflicts(runtime)
  if (conflicts.length > 0) {
    out.line(formatChecks(conflicts))
    out.result({ command: 'start', ok: false, running: false, results: conflicts })
    return 1
  }
  if (options.json) {
    out.result({ command: 'start', ok: false, running: false, error: JSON_REFUSAL, docs: 'INSTALL.md#起動する' })
    return 1
  }

  const current = await currentBuildInputs(system, repo, env)
  const decision = buildDecision({ record: parseBuildRecord(await system.readText(repo.webBuildRecord)), current, force: options.build })
  if (decision.kind === 'stale') {
    out.line(`画面を組み立て直します（${staleReasonText(decision.reason)}）`)
    const record = current.commit === null ? null : { commit: current.commit, publicEnv: current.publicEnv }
    const code = await buildWeb(system, repo, out, record)
    if (code !== 0) return code
  }
  out.line(`ixa を起動します: ${WEB_URL}（止めるときは Ctrl+C）`)
  return exitCodeOf(await system.run('pnpm', SERVE_ARGS, { cwd: repo.root, inherit: 'all' }))
}
