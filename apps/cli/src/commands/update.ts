import type { Options } from '../args.js'
import { devIsRunning, gatherRuntime } from '../checks/runtime.js'
import { missingEnvKeys } from '../lib/env-file.js'
import { parseRootPackage, RELEASES_URL, type RepoPaths } from '../lib/repo.js'
import { formatVersion, type Version } from '../lib/semver.js'
import { formatStep, type Output } from '../printer.js'
import { runSteps, type Step } from '../setup/run-steps.js'
import { audioDepsStep, infraStep, migrateStep, readEnv, type SetupContext } from '../setup/steps.js'
import type { System } from '../system.js'
import { hasFailure, isStopping, type StepResult } from '../types.js'
import {
  describeMove,
  fastForwardBlocker,
  fastForwardOf,
  parseVersionOrThrow,
  releaseTarget,
  updateBlockers,
} from '../update/decide.js'
import { createGit, type Git } from '../update/git.js'
import { checkActiveJobs, jobsGuard } from '../update/jobs.js'
import { finalDoctor } from './doctor.js'

/**
 * `pnpm ixa update`（ADR-0063）。**2 段に分ける**：今の版の CLI は「止める条件の確認・取ってくる・
 * pnpm install」まで（新しい版の CLI を起こすには依存が要る）。続き（uv sync・DB の更新・新しい項目・
 * doctor）は新しい版の CLI を `--after-fetch --from <前の版>` で起こし直してやらせる
 * （古いコードのまま後半を走らせない）。
 */

const currentVersion = async (system: System, repo: RepoPaths): Promise<Version> =>
  parseVersionOrThrow(parseRootPackage((await system.readText(repo.rootPackage)) ?? '{}').version, 'package.json')

type Resolved =
  | { readonly kind: 'move'; readonly ref: string; readonly version: Version }
  | { readonly kind: 'up-to-date' }
  | { readonly kind: 'no-release' }

const resolveTarget = async (git: Git, current: Version, main: boolean): Promise<Resolved> => {
  if (main) {
    const version = parseVersionOrThrow(parseRootPackage(await git.versionAt('origin/main')).version, 'origin/main')
    return (await git.ancestry('origin/main')).same ? { kind: 'up-to-date' } : { kind: 'move', ref: 'origin/main', version }
  }
  const target = releaseTarget(await git.tags(), current)
  if (target.kind === 'none') return { kind: 'no-release' }
  return target.kind === 'up-to-date' ? { kind: 'up-to-date' } : { kind: 'move', ref: target.ref, version: target.version }
}

const finish = (out: Output, ok: boolean, steps: readonly StepResult[], extra: Record<string, unknown>): number => {
  steps.forEach((s) => out.line(formatStep(s)))
  out.result({ command: 'update', ok, steps, ...extra })
  return ok ? 0 : 1
}

const installFailed = (from: Version): StepResult => ({
  id: 'update.install',
  status: 'failed',
  message: 'pnpm install に失敗しました（コードは新しい版になっています）',
  fix: {
    hint: '出力のエラーを見て直し、続きを回す',
    command: `pnpm install && pnpm -s ixa update --after-fetch --from ${formatVersion(from)}`,
    needsHuman: false,
  },
  docs: 'INSTALL.md#更新',
})

/** 取り込んで依存を入れ、新しい版の CLI に続きを渡す。 */
const moveAndHandOff = async (system: System, repo: RepoPaths, out: Output, options: Options, git: Git, from: Version, ref: string): Promise<number> => {
  await git.fastForward(ref)
  out.line(`✓ ${ref} を取り込みました`)
  system.progress('依存を入れています（pnpm install --frozen-lockfile）…')
  const install = await system.run('pnpm', ['install', '--frozen-lockfile'], { cwd: repo.root, inherit: 'to-stderr', timeoutMs: 900_000 })
  if (install.kind !== 'completed' || install.exitCode !== 0) return finish(out, false, [installFailed(from)], {})
  out.line('✓ 依存を入れました（pnpm install）\n— ここから新しい版の CLI で続けます —')
  const flags = [...(options.main ? ['--main'] : []), ...(options.json ? ['--json'] : []), ...(options.yes ? ['--yes'] : [])]
  const next = await system.run('pnpm', ['-s', 'ixa', 'update', '--after-fetch', '--from', formatVersion(from), ...flags], {
    cwd: repo.root,
    inherit: 'all',
  })
  return next.kind === 'completed' ? next.exitCode : 1
}

/** 1 段目（今の版の CLI）。 */
const fetchStage = async (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  const git = createGit(system, repo)
  const current = await currentVersion(system, repo)
  const jobs = jobsGuard(await checkActiveJobs(system, await readEnv(system, repo)), options.force)
  jobs.steps.filter((s) => !isStopping(s)).forEach((s) => out.line(formatStep(s)))
  const jobsJson = { activeJobs: jobs.counts, activeJobsReason: jobs.reason }
  const blockers = [
    ...jobs.steps.filter(isStopping),
    ...updateBlockers({ dirty: await git.dirty(), branch: await git.branch(), activeJobs: jobs.counts, force: options.force }),
  ]
  system.progress('新しい版を確かめています（git fetch --tags）…')
  await git.fetch()
  const target = await resolveTarget(git, current, options.main)
  const from = formatVersion(current)
  if (target.kind === 'no-release') {
    return finish(out, false, [{ id: 'update.target', status: 'failed', message: 'リリースのタグ（vX.Y.Z）が見つかりません' }], { from, ...jobsJson })
  }
  if (target.kind === 'up-to-date') {
    out.line(`✓ 最新です（${from}）`)
    return finish(out, true, [], { from, to: from, upToDate: true, ...jobsJson })
  }
  const to = formatVersion(target.version)
  const relation = fastForwardOf(await git.ancestry(target.ref))
  // タグの名前は新しいが中身は今と同じ（package.json の版を上げ忘れたタグなど）。取り込むものが無い。
  if (relation === 'same') {
    out.line(`✓ 最新です（${target.ref} と同じコミット）`)
    return finish(out, true, [], { from, to: from, upToDate: true, ...jobsJson })
  }
  const ff = fastForwardBlocker(relation, target.ref)
  const allBlockers = [...blockers, ...(ff === null ? [] : [ff])]
  out.line(`新しい版があります: ${describeMove(current, target.version)}`)
  if (options.check) return finish(out, true, allBlockers, { check: true, from, to, ...jobsJson })
  if (allBlockers.length > 0) return finish(out, false, allBlockers, { from, to, ...jobsJson })
  return moveAndHandOff(system, repo, out, options, git, current, target.ref)
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

/** 2 段目（新しい版の CLI）。 */
const afterFetchStage = async (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  const ctx: SetupContext = { system, repo, yes: options.yes }
  const to = formatVersion(await currentVersion(system, repo))
  const from = options.from ?? to
  const steps: readonly Step<SetupContext>[] = [
    () => Promise.resolve({ id: 'update.fetch', status: 'done', message: `${from} → ${to} のコードと依存を入れました` }),
    audioDepsStep,
    async (c) => infraStep(c, await readEnv(c.system, c.repo)),
    async (c) => migrateStep(c, await readEnv(c.system, c.repo)),
    (c) => newKeysStep(c.system, c.repo),
  ]
  const results = await runSteps(ctx, steps, out)
  const proceed = !results.some(isStopping)
  const releaseNotes = releaseNotesUrl(from, to, options.main)
  out.line(`\n変更点: ${releaseNotes}`)
  const checks = proceed ? await finalDoctor(system, repo, out) : []
  const devRestartNeeded = devIsRunning(await gatherRuntime(system, await readEnv(system, repo), repo.root))
  if (devRestartNeeded) out.line('\n! dev が動いています。新しい版にするため起動し直してください（Ctrl+C で止めて pnpm dev）')
  const ok = proceed && !hasFailure(checks)
  out.result({ command: 'update', ok, from, to, releaseNotes, devRestartNeeded, steps: results, results: checks })
  return ok ? 0 : 1
}

export const updateCommand = (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> =>
  options.afterFetch ? afterFetchStage(system, repo, out, options) : fetchStage(system, repo, out, options)
