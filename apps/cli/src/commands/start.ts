import type { Options } from '../args.js'
import { gatherDb, judgeDb } from '../checks/db.js'
import { gatherEnv, judgeEnv } from '../checks/env.js'
import { gatherRuntime, judgeRuntime, type RuntimeFacts } from '../checks/runtime.js'
import { parseEnvFile, type EnvValues } from '../lib/env-file.js'
import { WEB_PORT, type RepoPaths } from '../lib/repo.js'
import { formatChecks, formatStep, type Output } from '../printer.js'
import { readEnv } from '../setup/steps.js'
import { acquireBuildLock, readBuildLock, releaseBuildLock, type BuildLock } from '../start/build-lock.js'
import { buildDecision, parseBuildRecord, publicEnvHashOf, staleReasonText, type BuildRecord } from '../start/build-record.js'
import type { RunResult, System } from '../system.js'
import type { CheckResult, StepResult } from '../types.js'
import { pendingUpdateStep, readMarker } from '../update/marker.js'

/**
 * `pnpm ixa start`（ADR-0068）。使う人のための起動。組み立て済みの画面（`next start`）と、
 * 見張らない api・worker・音の解析を `turbo run serve` で起こし、端末につなぐ（Ctrl+C で止まる）。
 *
 * `pnpm dev` は開くたびに組み立て直し、`next dev` はメモリが増えると自分で起動し直す（開発のための形）。
 * 画面はコードか `NEXT_PUBLIC_*` が変わったときだけ組み立て直す（`start/build-record.ts`）。
 *
 * 起こす前に止める順: 途中の更新 → `.env` → 組み立て中 → もう動いている（全部 / 一部）→ ポートの持ち主 →
 * 設定と DB（doctor と同じ点検）→ `--json` → 組み立て → 起動。
 */

const WEB_URL = `http://localhost:${String(WEB_PORT)}`
const BUILD_ARGS = ['--filter', '@ixa/web', 'run', 'build:start'] as const
const SERVE_ARGS = ['exec', 'turbo', 'run', 'serve'] as const
const START_DOCS = 'INSTALL.md#起動する'

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

/** 起こす前に見る doctor の点検（起動してから turbo ごと落ちる原因になるもの）。新しい点検は作らない。 */
const PREFLIGHT_IDS: readonly string[] = ['env.valid', 'db.postgres', 'db.redis', 'db.migrations']

const LABEL = { web: '画面（web）', api: 'API', audio: '音の解析' } as const

const exitCodeOf = (result: RunResult): number => (result.kind === 'completed' ? result.exitCode : 1)

/** 止める。表示は 1 つの手順として、`--json` には同じものを `steps` で返す。 */
const stop = (out: Output, step: StepResult, extra: Record<string, unknown> = {}): number => {
  out.line(formatStep(step))
  out.result({ command: 'start', ok: false, running: false, steps: [step], ...extra })
  return 1
}

const buildingStep = (lock: BuildLock | null): StepResult => ({
  id: 'start.building',
  status: 'failed',
  message: `画面を組み立てている最中です${lock === null ? '' : `（pid ${String(lock.pid)}、${lock.startedAt} から）`}。終わればその start が起動します`,
  fix: { hint: '組み立てている端末を待つ。様子は pnpm -s ixa doctor --json の runtime.web-build', needsHuman: false },
  docs: START_DOCS,
})

const runningStep = (build: boolean): StepResult | null =>
  build
    ? {
        id: 'start.running',
        status: 'failed',
        message: `この clone の ixa はもう動いているので、組み立て直していません（${WEB_URL}）`,
        fix: { hint: '起動した端末で Ctrl+C で止めてから pnpm ixa start --build', needsHuman: false },
        docs: START_DOCS,
      }
    : null

/** 一部だけ動いている（前に起こした音の解析だけが残っている、など）。残りを止めてから起こし直す。 */
const partialStep = (facts: RuntimeFacts): StepResult => {
  const up = facts.ports.filter((p) => p.owner.kind === 'this-repo')
  const down = facts.ports.filter((p) => p.owner.kind !== 'this-repo')
  const first = up[0]
  return {
    id: 'start.partial',
    status: 'failed',
    message: `この clone の ixa が一部だけ動いています（動いている: ${up.map((p) => LABEL[p.name]).join('・')} / 動いていない: ${down.map((p) => LABEL[p.name]).join('・')}）`,
    fix: {
      hint: '残っているものを止めてから pnpm ixa start（起動した端末で Ctrl+C。端末が分からなければ、下の 1 行でプロセスを確かめて止める）',
      ...(first === undefined ? {} : { command: `lsof -nP -iTCP:${String(first.port)} -sTCP:LISTEN` }),
      needsHuman: false,
    },
    docs: 'INSTALL.md#動いているもの',
  }
}

const headCommit = async (system: System, repo: RepoPaths): Promise<string | null> => {
  const result = await system.run('git', ['rev-parse', 'HEAD'], { cwd: repo.root, timeoutMs: 10_000 })
  return result.kind === 'completed' && result.exitCode === 0 ? result.stdout.trim() : null
}

const envAt = async (system: System, file: string): Promise<EnvValues> => parseEnvFile((await system.readText(file)) ?? '')

/** 今の版と、画面に焼き込まれる値の指紋（読む先と強さは build-record.ts）。 */
const currentBuildInputs = async (system: System, repo: RepoPaths, rootEnv: EnvValues) => {
  const [webEnvProductionLocal, webEnvLocal, webEnvProduction, webEnv] = await Promise.all(
    [repo.webEnvProductionLocal, repo.webEnvLocal, repo.webEnvProduction, repo.webEnv].map((file) => envAt(system, file)),
  )
  const publicEnv = publicEnvHashOf({
    processEnv: system.processEnv,
    webEnvProductionLocal: webEnvProductionLocal ?? {},
    webEnvLocal: webEnvLocal ?? {},
    webEnvProduction: webEnvProduction ?? {},
    webEnv: webEnv ?? {},
    rootEnv,
  })
  return { commit: await headCommit(system, repo), publicEnv }
}

/** ほかのものがポートを使っていれば、起動してから落ちる前に止める（doctor と同じ点検を見せる）。 */
const portConflicts = (facts: RuntimeFacts): readonly CheckResult[] =>
  judgeRuntime(facts).filter((r) => r.id.startsWith('runtime.port-') && r.level !== 'ok')

/** 設定と DB。止まっている Docker や形の違う `.env` を、組み立てに数分かけた後ではなく先に見つける。 */
const preflightFailures = async (system: System, repo: RepoPaths, env: EnvValues): Promise<readonly CheckResult[]> => {
  const [envFacts, dbFacts] = await Promise.all([gatherEnv(system, repo), gatherDb(system, env, repo.root)])
  return [...judgeEnv(envFacts), ...judgeDb(dbFacts)].filter((r) => PREFLIGHT_IDS.includes(r.id) && r.level === 'fail')
}

/**
 * 画面を組み立てる。組み立ての間は印を持つ（終われば失敗でも消す）。成功したときだけ記録を書く。
 * 版が分からない（`record` が null）ときは記録を書かない。次も組み立て直す（buildDecision）。
 */
const buildWeb = async (system: System, repo: RepoPaths, out: Output, record: BuildRecord | null): Promise<number> => {
  const lock = await acquireBuildLock(system, repo, new Date())
  if (lock.kind === 'held') return stop(out, buildingStep(lock.lock))
  if (lock.cleared !== null) out.line(`! ${lock.cleared}。その印を消して組み立てます`)
  try {
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
  } finally {
    await releaseBuildLock(system, repo)
  }
}

/** 起こしてよいか。止めるなら終了コード、起こしてよければ null。 */
const checkBeforeStart = async (system: System, repo: RepoPaths, out: Output, options: Options, env: EnvValues): Promise<number | null> => {
  const lock = await readBuildLock(system, repo)
  if (lock.kind === 'held') return stop(out, buildingStep(lock.lock))
  const runtime = await gatherRuntime(system, env, repo.root)
  const mine = runtime.ports.filter((p) => p.owner.kind === 'this-repo')
  if (mine.length === runtime.ports.length) {
    const rebuildRefused = runningStep(options.build)
    if (rebuildRefused !== null) return stop(out, rebuildRefused, { url: WEB_URL })
    out.line(`✓ この clone の ixa はもう動いています: ${WEB_URL}（止めるなら起動した端末で Ctrl+C）`)
    out.result({ command: 'start', ok: true, running: true, url: WEB_URL })
    return 0
  }
  if (mine.length > 0) return stop(out, partialStep(runtime))
  const conflicts = portConflicts(runtime)
  const failures = conflicts.length > 0 ? conflicts : await preflightFailures(system, repo, env)
  if (failures.length > 0) {
    out.line(formatChecks(failures))
    out.result({ command: 'start', ok: false, running: false, results: failures })
    return 1
  }
  if (options.json) {
    out.result({ command: 'start', ok: false, running: false, error: JSON_REFUSAL, docs: START_DOCS })
    return 1
  }
  return null
}

export const startCommand = async (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  // 更新が途中で止まっていると、コードは新しく依存か DB が古い。組み立てると新しい版を「組み立て済み」と記録してしまう。
  const marker = await readMarker(system, repo)
  if (marker !== null) return stop(out, pendingUpdateStep(marker))
  if ((await system.readText(repo.env)) === null) return stop(out, noEnv)
  const env = await readEnv(system, repo)
  const stopped = await checkBeforeStart(system, repo, out, options, env)
  if (stopped !== null) return stopped

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
