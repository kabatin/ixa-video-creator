import { majorOf, versionIn } from '../lib/semver.js'
import type { RunResult, System } from '../system.js'
import type { CheckResult, Fix } from '../types.js'

/**
 * 道具の点検（Node・pnpm・git・Docker・FFmpeg・uv）。**足りなければ入れ方の 1 行を出すだけで、入れない。**
 * Homebrew で入れるのは人の同意が要る（needsHuman）。
 */

export const REQUIRED_NODE_MAJOR = 22

/** 道具ごとの「版を聞く」打ち方。 */
export const TOOL_PROBES = {
  pnpm: ['pnpm', ['--version']],
  git: ['git', ['--version']],
  docker: ['docker', ['--version']],
  dockerDaemon: ['docker', ['info', '--format', '{{.ServerVersion}}']],
  compose: ['docker', ['compose', 'version']],
  ffmpeg: ['ffmpeg', ['-version']],
  ffprobe: ['ffprobe', ['-version']],
  uv: ['uv', ['--version']],
  brew: ['brew', ['--version']],
} as const satisfies Record<string, readonly [string, readonly string[]]>

export type ToolName = keyof typeof TOOL_PROBES

export type ToolFacts = {
  readonly nodeVersion: string
  readonly expectedPnpm: string | null
  readonly results: Readonly<Record<ToolName, RunResult>>
}

const DOCS = 'INSTALL.md#道具'

/** 動いた（終了コード 0）なら出力、そうでなければ null。 */
const outputOf = (result: RunResult): string | null =>
  result.kind === 'completed' && result.exitCode === 0 ? `${result.stdout}\n${result.stderr}` : null

const brewFix = (formula: string, brewMissing: boolean): Fix =>
  brewMissing
    ? {
        hint: `Homebrew（https://brew.sh）を入れてから brew install ${formula}。入れる前に制作者に確かめる`,
        needsHuman: true,
      }
    : { hint: `Homebrew で入れる。入れる前に制作者に確かめる`, command: `brew install ${formula}`, needsHuman: true }

const nodeCheck = (version: string): CheckResult => {
  const major = majorOf(version)
  return major !== null && major >= REQUIRED_NODE_MAJOR
    ? { id: 'tools.node', group: 'tools', level: 'ok', message: `Node ${version}` }
    : {
        id: 'tools.node',
        group: 'tools',
        level: 'fail',
        message: `Node ${version} は古すぎます（${String(REQUIRED_NODE_MAJOR)} 以上が要る）`,
        fix: { hint: 'Node 22 を入れる。入れる前に制作者に確かめる', command: 'brew install node@22', needsHuman: true },
        docs: DOCS,
      }
}

const pnpmCheck = (result: RunResult, expected: string | null): CheckResult => {
  const id = 'tools.pnpm'
  const version = versionIn(outputOf(result) ?? '')
  const activate: Fix = {
    hint: 'corepack で決まった版を使う',
    command: `corepack enable && corepack prepare pnpm@${expected ?? '9'} --activate`,
    needsHuman: false,
  }
  if (version === null) return { id, group: 'tools', level: 'fail', message: 'pnpm が入っていません', fix: activate, docs: DOCS }
  if (expected === null || version === expected) return { id, group: 'tools', level: 'ok', message: `pnpm ${version}` }
  return majorOf(version) === majorOf(expected)
    ? { id, group: 'tools', level: 'warn', message: `pnpm ${version}（決めた版は ${expected}）`, fix: activate, docs: DOCS }
    : { id, group: 'tools', level: 'fail', message: `pnpm ${version} は版が違います（${expected} が要る）`, fix: activate, docs: DOCS }
}

const simpleCheck = (
  id: string,
  label: string,
  result: RunResult,
  missingFix: Fix,
  docs: string = DOCS,
): CheckResult => {
  const output = outputOf(result)
  if (output === null) {
    return { id, group: 'tools', level: 'fail', message: `${label} が入っていません`, fix: missingFix, docs }
  }
  const version = versionIn(output)
  return { id, group: 'tools', level: 'ok', message: version === null ? label : `${label} ${version}` }
}

const dockerChecks = (results: ToolFacts['results']): readonly CheckResult[] => {
  const docs = 'INSTALL.md#docker'
  const installed = simpleCheck(
    'tools.docker',
    'Docker',
    results.docker,
    {
      hint: 'Docker Desktop を入れてもらう（https://www.docker.com/products/docker-desktop/）。制作者の操作が要る',
      needsHuman: true,
    },
    docs,
  )
  if (installed.level === 'fail') {
    return [
      installed,
      { id: 'tools.docker-running', group: 'tools', level: 'skip', message: 'Docker が無いので見ません' },
    ]
  }
  const running: CheckResult =
    outputOf(results.dockerDaemon) === null
      ? {
          id: 'tools.docker-running',
          group: 'tools',
          level: 'fail',
          message: 'Docker が動いていません',
          fix: { hint: 'Docker Desktop を起動して、1 分ほど待つ', command: 'open -a Docker', needsHuman: false },
          docs,
        }
      : { id: 'tools.docker-running', group: 'tools', level: 'ok', message: 'Docker が動いています' }
  const compose = simpleCheck(
    'tools.docker-compose',
    'docker compose',
    results.compose,
    { hint: 'Docker Desktop を新しくする（compose が入っている）。制作者の操作が要る', needsHuman: true },
    docs,
  )
  return [installed, running, compose]
}

/** 判定（純粋）。 */
export const judgeTools = (facts: ToolFacts): readonly CheckResult[] => {
  const brewMissing = outputOf(facts.results.brew) === null
  return [
    nodeCheck(facts.nodeVersion),
    pnpmCheck(facts.results.pnpm, facts.expectedPnpm),
    simpleCheck('tools.git', 'git', facts.results.git, {
      hint: 'Xcode のコマンドラインツールを入れる。入れる前に制作者に確かめる',
      command: 'xcode-select --install',
      needsHuman: true,
    }),
    ...dockerChecks(facts.results),
    simpleCheck('tools.ffmpeg', 'FFmpeg', facts.results.ffmpeg, brewFix('ffmpeg', brewMissing)),
    simpleCheck('tools.ffprobe', 'ffprobe', facts.results.ffprobe, brewFix('ffmpeg', brewMissing)),
    simpleCheck('tools.uv', 'uv', facts.results.uv, brewFix('uv', brewMissing)),
  ]
}

/** 調べる（外の口）。 */
export const gatherTools = async (system: System, expectedPnpm: string | null): Promise<ToolFacts> => {
  const names = Object.keys(TOOL_PROBES) as ToolName[]
  const results = await Promise.all(
    names.map(async (name) => {
      const [command, args] = TOOL_PROBES[name]
      return [name, await system.run(command, args, { timeoutMs: 15_000 })] as const
    }),
  )
  return {
    nodeVersion: system.nodeVersion,
    expectedPnpm,
    results: Object.fromEntries(results) as Record<ToolName, RunResult>,
  }
}
