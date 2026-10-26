import type { RepoPaths } from '../lib/repo.js'
import type { RunResult, System } from '../system.js'
import type { Ancestry } from './decide.js'

/** update が使う git の口（外の口。判定は decide.ts）。 */

export type Git = ReturnType<typeof createGit>

const ok = (r: RunResult): r is Extract<RunResult, { kind: 'completed' }> => r.kind === 'completed' && r.exitCode === 0

const failure = (what: string, r: RunResult): Error =>
  new Error(`${what} に失敗しました（${r.kind === 'completed' ? r.stderr.trim().split('\n').slice(-1).join('') : r.kind}）`)

export const createGit = (system: System, repo: RepoPaths) => {
  const git = (args: readonly string[], timeoutMs = 30_000) => system.run('git', args, { cwd: repo.root, timeoutMs })
  const out = async (args: readonly string[], what: string): Promise<string> => {
    const r = await git(args)
    if (!ok(r)) throw failure(what, r)
    return r.stdout.trim()
  }
  const isAncestor = async (a: string, b: string): Promise<boolean> => ok(await git(['merge-base', '--is-ancestor', a, b]))
  return {
    dirty: async (): Promise<boolean> => (await out(['status', '--porcelain', '--untracked-files=no'], 'git status')) !== '',
    branch: async (): Promise<string> => {
      const name = await out(['rev-parse', '--abbrev-ref', 'HEAD'], 'ブランチの確認')
      return name === 'HEAD' ? '' : name
    },
    fetch: async (): Promise<void> => {
      const r = await git(['fetch', '--tags', 'origin'], 180_000)
      if (!ok(r)) throw failure('git fetch', r)
    },
    tags: async (): Promise<readonly string[]> => (await out(['tag', '--list', 'v*'], 'タグの一覧')).split('\n').filter(Boolean),
    /** その時点の package.json の版。 */
    versionAt: async (ref: string): Promise<string> => out(['show', `${ref}:package.json`], `${ref} の package.json`),
    ancestry: async (ref: string): Promise<Ancestry> => {
      const [head, target] = await Promise.all([
        out(['rev-parse', 'HEAD'], 'HEAD'),
        out(['rev-parse', `${ref}^{commit}`], ref),
      ])
      return {
        same: head === target,
        headBehind: await isAncestor('HEAD', ref),
        headAhead: await isAncestor(ref, 'HEAD'),
      }
    },
    fastForward: async (ref: string): Promise<void> => {
      const r = await git(['merge', '--ff-only', ref])
      if (!ok(r)) throw failure(`${ref} への fast-forward`, r)
    },
  }
}
