import type { Options } from '../args.js'
import { finalDoctor } from '../commands/doctor.js'
import { devIsRunning, gatherRuntime } from '../checks/runtime.js'
import { missingEnvKeys } from '../lib/env-file.js'
import { parseRootPackage, RELEASES_URL, type RepoPaths } from '../lib/repo.js'
import { formatVersion } from '../lib/semver.js'
import { formatStep, type Output } from '../printer.js'
import { runSteps, type Step } from '../setup/run-steps.js'
import { audioDepsStep, infraStep, migrateStep, readEnv, type SetupContext } from '../setup/steps.js'
import type { System } from '../system.js'
import { hasFailure, isStopping, type StepResult } from '../types.js'
import { parseVersionOrThrow } from './decide.js'
import { RESUME_COMMAND, readMarker, removeMarker } from './marker.js'

/**
 * update の後半（ADR-0063）。`pnpm install` と、**新しい版の CLI** による 2 段目
 * （uv sync・Docker・DB の更新・新しい項目・doctor）。1 段目と `--resume` の両方から通る。
 */

const installFailed: StepResult = {
  id: 'update.install',
  status: 'failed',
  message: 'pnpm install に失敗しました（コードは新しい版になっています）',
  fix: { hint: '出力のエラーを見て直し、続きを回す', command: RESUME_COMMAND, needsHuman: false },
  docs: 'INSTALL.md#更新',
}

/** 依存を入れ、新しい版の CLI に続きを渡す（その終了コードを返す）。 */
export const installAndHandOff = async (system: System, repo: RepoPaths, out: Output, options: Options, from: string): Promise<number> => {
  system.progress('依存を入れています（pnpm install --frozen-lockfile）…')
  const install = await system.run('pnpm', ['install', '--frozen-lockfile'], { cwd: repo.root, inherit: 'to-stderr', timeoutMs: 900_000 })
  if (install.kind !== 'completed' || install.exitCode !== 0) {
    out.line(formatStep(installFailed))
    out.result({ command: 'update', ok: false, steps: [installFailed] })
    return 1
  }
  out.line('✓ 依存を入れました（pnpm install）\n— ここから新しい版の CLI で続けます —')
  const flags = [...(options.main ? ['--main'] : []), ...(options.json ? ['--json'] : []), ...(options.yes ? ['--yes'] : [])]
  const next = await system.run('pnpm', ['-s', 'ixa', 'update', '--after-fetch', '--from', from, ...flags], {
    cwd: repo.root,
    inherit: 'all',
  })
  return next.kind === 'completed' ? next.exitCode : 1
}

/** `--resume`: 途中で止まった更新の続き。印が無ければ何もしない。 */
export const resumeStage = async (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  const marker = await readMarker(system, repo)
  if (marker === null) {
    out.line('✓ 途中で止まった更新はありません')
    out.result({ command: 'update', ok: true, resumed: false, steps: [] })
    return 0
  }
  out.line(`前の更新（${marker.from} → ${marker.to}）の続きをします`)
  return installAndHandOff(system, repo, out, { ...options, main: marker.main }, marker.from)
}

const newKeysStep = async (system: System, repo: RepoPaths): Promise<StepResult> => {
  const [example, env] = await Promise.all([system.readText(repo.envExample), system.readText(repo.env)])
  const missing = example === null || env === null ? [] : missingEnvKeys(example, env)
  return missing.length === 0
    ? { id: 'update.new-keys', status: 'already', message: '.env に足す新しい項目はありません' }
    : {
        id: 'update.new-keys',
        status: 'notice',
        message: `新しい版で増えた .env の項目（値は書いていません。無ければ既定で動きます）: ${missing.join(', ')}`,
        fix: { hint: '.env.example の説明を読み、要るものだけ .env に足す（鍵は制作者に聞く）', needsHuman: false },
        docs: 'INSTALL.md#更新',
      }
}

/** 変更点の場所。リリースならそのタグ、main ならリリースからの差分。 */
export const releaseNotesUrl = (from: string, to: string, main: boolean): string =>
  main ? `${RELEASES_URL.replace(/\/releases$/, '')}/compare/v${from}...main` : `${RELEASES_URL}/tag/v${to}`

/** 2 段目（新しい版の CLI）。手順が止まらずに済んだら途中の印を消す。 */
export const afterFetchStage = async (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  const ctx: SetupContext = { system, repo, yes: options.yes }
  const to = formatVersion(parseVersionOrThrow(parseRootPackage((await system.readText(repo.rootPackage)) ?? '{}').version, 'package.json'))
  const from = options.from ?? to
  const steps: readonly Step<SetupContext>[] = [
    () => Promise.resolve({ id: 'update.fetch', status: 'done', message: `${from} → ${to} のコードと依存を入れました` }),
    audioDepsStep,
    async (c) => infraStep(c, await readEnv(c.system, c.repo)),
    async (c) => migrateStep(c, await readEnv(c.system, c.repo)),
    (c) => newKeysStep(c.system, c.repo),
  ]
  const results = await runSteps(ctx, steps, out, RESUME_COMMAND)
  const proceed = !results.some(isStopping)
  if (proceed) await removeMarker(system, repo)
  else out.line(`\n途中で止まりました。直してから続きを回してください: ${RESUME_COMMAND}`)
  const releaseNotes = releaseNotesUrl(from, to, options.main)
  out.line(`\n変更点: ${releaseNotes}`)
  const checks = proceed ? await finalDoctor(system, repo, out) : []
  const devRestartNeeded = devIsRunning(await gatherRuntime(system, await readEnv(system, repo), repo.root))
  if (devRestartNeeded) out.line('\n! dev が動いています。新しい版にするため起動し直してください（Ctrl+C で止めて pnpm dev）')
  const ok = proceed && !hasFailure(checks)
  out.result({ command: 'update', ok, from, to, releaseNotes, devRestartNeeded, steps: results, results: checks })
  return ok ? 0 : 1
}
