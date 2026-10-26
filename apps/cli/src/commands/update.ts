import type { Options } from '../args.js'
import { devIsRunning, gatherRuntime } from '../checks/runtime.js'
import { parseRootPackage, type RepoPaths } from '../lib/repo.js'
import { formatVersion, type Version } from '../lib/semver.js'
import { formatStep, type Output } from '../printer.js'
import { readEnv } from '../setup/steps.js'
import type { System } from '../system.js'
import { isStopping, type StepResult } from '../types.js'
import { afterFetchStage, installAndHandOff, resumeStage } from '../update/after-fetch.js'
import {
  describeMove,
  devRunningBlocker,
  fastForwardBlocker,
  fastForwardOf,
  parseVersionOrThrow,
  releaseTarget,
  updateBlockers,
} from '../update/decide.js'
import { createGit, type Git } from '../update/git.js'
import { checkActiveJobs, jobsGuard } from '../update/jobs.js'
import { pendingUpdateStep, readMarker, writeMarker } from '../update/marker.js'

/**
 * `pnpm ixa update`（ADR-0063）。**2 段に分ける**：今の版の CLI は「止める条件の確認・取ってくる」まで。
 * 取り込んだら途中の印を置き、pnpm install のあと新しい版の CLI を `--after-fetch --from <前の版>` で起こし直して
 * 続き（uv sync・DB の更新・新しい項目・doctor）をやらせる（古いコードのまま後半を走らせない）。
 * 途中で止まったら `--resume` で続きから。
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

/** 止める条件（ジョブ・作業ツリー・ブランチ・dev）と、知らせるだけの手順。 */
const guards = async (system: System, repo: RepoPaths, out: Output, options: Options, git: Git) => {
  const env = await readEnv(system, repo)
  const jobs = jobsGuard(await checkActiveJobs(system, env), options.force)
  jobs.steps.filter((s) => !isStopping(s)).forEach((s) => out.line(formatStep(s)))
  const dev = devRunningBlocker(devIsRunning(await gatherRuntime(system, env, repo.root)), options.whileRunning)
  const blockers = [
    ...jobs.steps.filter(isStopping),
    ...updateBlockers({ dirty: await git.dirty(), branch: await git.branch(), activeJobs: jobs.counts, force: options.force }),
    ...(dev === null ? [] : [dev]),
  ]
  return { blockers, json: { activeJobs: jobs.counts, activeJobsReason: jobs.reason } }
}

/** 1 段目（今の版の CLI）。 */
const fetchStage = async (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  const marker = await readMarker(system, repo)
  if (marker !== null) return finish(out, false, [pendingUpdateStep(marker)], { from: marker.from, to: marker.to, pending: true })
  const git = createGit(system, repo)
  const current = await currentVersion(system, repo)
  const from = formatVersion(current)
  const { blockers, json } = await guards(system, repo, out, options, git)
  system.progress('新しい版を確かめています（git fetch --tags）…')
  await git.fetch()
  const target = await resolveTarget(git, current, options.main)
  if (target.kind === 'no-release') {
    return finish(out, false, [{ id: 'update.target', status: 'failed', message: 'リリースのタグ（vX.Y.Z）が見つかりません' }], { from, ...json })
  }
  if (target.kind === 'up-to-date') {
    out.line(`✓ 最新です（${from}）`)
    return finish(out, true, [], { from, to: from, upToDate: true, ...json })
  }
  const to = formatVersion(target.version)
  const relation = fastForwardOf(await git.ancestry(target.ref))
  // タグの名前は新しいが中身は今と同じ（package.json の版を上げ忘れたタグなど）。取り込むものが無い。
  if (relation === 'same') {
    out.line(`✓ 最新です（${target.ref} と同じコミット）`)
    return finish(out, true, [], { from, to: from, upToDate: true, ...json })
  }
  const ff = fastForwardBlocker(relation, target.ref)
  const allBlockers = [...blockers, ...(ff === null ? [] : [ff])]
  out.line(`新しい版があります: ${describeMove(current, target.version)}`)
  if (options.check) return finish(out, true, allBlockers, { check: true, from, to, ...json })
  if (allBlockers.length > 0) return finish(out, false, allBlockers, { from, to, ...json })
  await git.fastForward(target.ref)
  await writeMarker(system, repo, { from, to, ref: target.ref, main: options.main, at: new Date().toISOString() })
  out.line(`✓ ${target.ref} を取り込みました`)
  return installAndHandOff(system, repo, out, options, from)
}

export const updateCommand = (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  if (options.afterFetch) return afterFetchStage(system, repo, out, options)
  if (options.resume) return resumeStage(system, repo, out, options)
  return fetchStage(system, repo, out, options)
}
