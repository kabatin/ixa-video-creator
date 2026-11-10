import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../args.js'
import { startCommand } from '../commands/start.js'
import { paths } from '../lib/repo.js'
import type { Output } from '../printer.js'
import { buildDecision, parseBuildRecord, publicEnvHashOf, type BuildRecord } from '../start/build-record.js'
import type { Listener, RunOptions, RunResult } from '../system.js'
import { done, fakeSystem } from './fake-system.js'

/** `pnpm ixa start`（ADR-0068）。組み立て済みの画面と、見張らない api・worker・音の解析を起こす。 */

const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)
const ENV = 'DATABASE_URL=postgresql://ixa:pw@127.0.0.1:5432/ixa\nNEXT_PUBLIC_API_URL=http://127.0.0.1:3001\nNEXT_PUBLIC_WORKSPACE_ID=01WS\n'
const repo = paths('/repo')
const ROOT_PACKAGE = JSON.stringify({ name: 'ixa-video-creator', version: '0.8.4' })

const BUILD = 'pnpm --filter @ixa/web run build:start'
const SERVE = 'pnpm exec turbo run serve'
const REV_PARSE = 'git rev-parse HEAD'

describe('buildDecision（画面を組み立て直すか。純粋）', () => {
  const publicEnv = publicEnvHashOf({ NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001', NEXT_PUBLIC_WORKSPACE_ID: '01WS' }, {})
  const record: BuildRecord = { commit: COMMIT_A, publicEnv }
  const current = { commit: COMMIT_A, publicEnv }

  it('記録が無ければ組み立てる', () => {
    expect(buildDecision({ record: null, current, force: false })).toEqual({ kind: 'stale', reason: 'missing' })
  })

  it('同じ版・同じ画面の設定なら組み立てない', () => {
    expect(buildDecision({ record, current, force: false })).toEqual({ kind: 'fresh' })
  })

  it('版が違えば組み立てる', () => {
    expect(buildDecision({ record, current: { ...current, commit: COMMIT_B }, force: false })).toEqual({ kind: 'stale', reason: 'commit' })
  })

  it('画面の設定（NEXT_PUBLIC_*）が違えば組み立てる', () => {
    const other = publicEnvHashOf({ NEXT_PUBLIC_API_URL: 'http://mac.local:3001', NEXT_PUBLIC_WORKSPACE_ID: '01WS' }, {})
    expect(other).not.toBe(publicEnv)
    expect(buildDecision({ record, current: { ...current, publicEnv: other }, force: false })).toEqual({ kind: 'stale', reason: 'public-env' })
  })

  it('--build なら記録が合っていても組み立てる', () => {
    expect(buildDecision({ record, current, force: true })).toEqual({ kind: 'stale', reason: 'forced' })
  })

  it('git の版が分からなければ毎回組み立てる（古い画面のまま起こさない）', () => {
    expect(buildDecision({ record, current: { ...current, commit: null }, force: false })).toEqual({ kind: 'stale', reason: 'unknown-commit' })
  })
})

describe('publicEnvHashOf', () => {
  it('NEXT_PUBLIC_* だけを見る（ほかの値・並び順では変わらない）', () => {
    const base = publicEnvHashOf({ NEXT_PUBLIC_A: '1', NEXT_PUBLIC_B: '2', DATABASE_URL: 'x' }, {})
    expect(publicEnvHashOf({ NEXT_PUBLIC_B: '2', NEXT_PUBLIC_A: '1', DATABASE_URL: 'y' }, {})).toBe(base)
    expect(publicEnvHashOf({ NEXT_PUBLIC_A: '1', NEXT_PUBLIC_B: '3' }, {})).not.toBe(base)
  })

  it('apps/web/.env.local の値が直下の .env に勝つ（Next.js が先に読むのと同じ）', () => {
    const root = { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001' }
    const local = { NEXT_PUBLIC_API_URL: 'http://mac.local:3001' }
    expect(publicEnvHashOf(root, local)).toBe(publicEnvHashOf(local, {}))
    expect(publicEnvHashOf(root, local)).not.toBe(publicEnvHashOf(root, {}))
  })
})

describe('parseBuildRecord', () => {
  it('無い・JSON でない・形が違う記録は無いものとして扱う', () => {
    expect(parseBuildRecord(null)).toBeNull()
    expect(parseBuildRecord('{')).toBeNull()
    expect(parseBuildRecord(JSON.stringify({ commit: 'main', publicEnv: 'x' }))).toBeNull()
    const record = { commit: COMMIT_A, publicEnv: 'c'.repeat(64) }
    expect(parseBuildRecord(JSON.stringify(record))).toEqual(record)
  })
})

type Harness = {
  readonly files?: Readonly<Record<string, string>>
  readonly answers?: Readonly<Record<string, RunResult>>
  readonly listeners?: Readonly<Record<number, Listener>>
}

const harness = ({ files = {}, answers = {}, listeners = {} }: Harness) => {
  const written = new Map<string, string>()
  const ran: { readonly line: string; readonly options: RunOptions | undefined }[] = []
  const removed: string[] = []
  const lines: string[] = []
  const results: unknown[] = []
  const all: Record<string, string> = { [repo.rootPackage]: ROOT_PACKAGE, ...files }
  const system = fakeSystem(
    {},
    {
      run: (command, args, options) => {
        const line = [command, ...args].join(' ')
        ran.push({ line, options })
        return Promise.resolve(answers[line] ?? { kind: 'not_found' })
      },
      readText: (p) => Promise.resolve(written.get(p) ?? all[p] ?? null),
      writeText: (p, c) => Promise.resolve(void written.set(p, c)),
      remove: (p) => Promise.resolve(void removed.push(p)),
      listener: (port) => Promise.resolve(listeners[port] ?? null),
    },
  )
  const out = (json: boolean): Output => ({ json, line: (t) => lines.push(t), result: (p) => results.push(p) })
  return { system, written, removed, ran, lines, results, out }
}

const recordFor = (commit: string): string =>
  JSON.stringify({ commit, publicEnv: publicEnvHashOf({ NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001', NEXT_PUBLIC_WORKSPACE_ID: '01WS' }, {}) })

describe('startCommand', () => {
  it('.env が無ければ何も起こさず setup を勧める', async () => {
    const h = harness({})
    expect(await startCommand(h.system, repo, h.out(false), parseCliArgs(['start']))).toBe(1)
    expect(h.ran.filter((r) => r.line !== REV_PARSE)).toEqual([])
    expect(h.lines.join('\n')).toContain('pnpm ixa setup')
  })

  it('この clone の ixa がもう動いていれば、何も起こさず場所だけ言う（--json でも答える）', async () => {
    for (const json of [false, true]) {
      const h = harness({ files: { [repo.env]: ENV }, listeners: { 3000: { pid: 10, cwd: '/repo/apps/web' } } })
      const argv = json ? ['start', '--json'] : ['start']
      expect(await startCommand(h.system, repo, h.out(json), parseCliArgs(argv))).toBe(0)
      expect(h.ran.map((r) => r.line).filter((l) => l === BUILD || l === SERVE)).toEqual([])
      expect(h.written.size).toBe(0)
      expect(h.results[0]).toMatchObject({ command: 'start', ok: true, running: true, url: 'http://localhost:3000' })
    }
  })

  it('ポートを別のものが使っていれば起こさない（起動してから落ちるのを先に止める）', async () => {
    const h = harness({ files: { [repo.env]: ENV }, listeners: { 3001: { pid: 77, cwd: '/somewhere/else' } } })
    expect(await startCommand(h.system, repo, h.out(true), parseCliArgs(['start']))).toBe(1)
    expect(h.ran.map((r) => r.line).filter((l) => l === BUILD || l === SERVE)).toEqual([])
    expect(h.results[0]).toMatchObject({ command: 'start', ok: false, results: [{ id: 'runtime.port-api', level: 'fail' }] })
  })

  it('--json では起動しない（止めるまで返らないため）。後ろで起こして doctor で見る、と答える', async () => {
    const h = harness({ files: { [repo.env]: ENV } })
    expect(await startCommand(h.system, repo, h.out(true), parseCliArgs(['start', '--json']))).toBe(1)
    expect(h.ran.map((r) => r.line).filter((l) => l === BUILD || l === SERVE)).toEqual([])
    expect(h.results[0]).toMatchObject({ command: 'start', ok: false, running: false })
    expect(JSON.stringify(h.results[0])).toContain('pnpm -s ixa doctor --json')
  })

  it('組み立てが要らなければ、そのまま serve を端末につないで起こし、その終了コードを返す', async () => {
    const h = harness({
      files: { [repo.env]: ENV, [repo.webBuildRecord]: recordFor(COMMIT_A) },
      answers: { [REV_PARSE]: done(`${COMMIT_A}\n`), [SERVE]: { kind: 'completed', exitCode: 130, stdout: '', stderr: '' } },
    })
    expect(await startCommand(h.system, repo, h.out(false), parseCliArgs(['start']))).toBe(130)
    expect(h.ran.map((r) => r.line)).not.toContain(BUILD)
    expect(h.ran.find((r) => r.line === SERVE)?.options).toMatchObject({ cwd: '/repo', inherit: 'all' })
  })

  it('版が変わっていれば組み立て、済んでから記録を書いて serve を起こす', async () => {
    const h = harness({
      files: { [repo.env]: ENV, [repo.webBuildRecord]: recordFor(COMMIT_A) },
      answers: { [REV_PARSE]: done(`${COMMIT_B}\n`), [BUILD]: done(''), [SERVE]: done('') },
    })
    expect(await startCommand(h.system, repo, h.out(false), parseCliArgs(['start']))).toBe(0)
    const order = h.ran.map((r) => r.line).filter((l) => l === BUILD || l === SERVE)
    expect(order).toEqual([BUILD, SERVE])
    expect(h.ran.find((r) => r.line === BUILD)?.options).toMatchObject({ cwd: '/repo', inherit: 'all' })
    expect(parseBuildRecord(h.written.get(repo.webBuildRecord) ?? null)?.commit).toBe(COMMIT_B)
    expect(h.lines.join('\n')).toContain('数分')
  })

  it('--build なら記録が合っていても組み立てる', async () => {
    const h = harness({
      files: { [repo.env]: ENV, [repo.webBuildRecord]: recordFor(COMMIT_A) },
      answers: { [REV_PARSE]: done(`${COMMIT_A}\n`), [BUILD]: done(''), [SERVE]: done('') },
    })
    expect(await startCommand(h.system, repo, h.out(false), parseCliArgs(['start', '--build']))).toBe(0)
    expect(h.ran.map((r) => r.line)).toContain(BUILD)
  })

  it('組み立てに失敗したら記録を書かず（前の記録も消す）、serve も起こさず、0 以外で返る', async () => {
    const h = harness({
      files: { [repo.env]: ENV, [repo.webBuildRecord]: recordFor(COMMIT_A) },
      answers: { [REV_PARSE]: done(`${COMMIT_B}\n`), [BUILD]: { kind: 'completed', exitCode: 2, stdout: '', stderr: '' }, [SERVE]: done('') },
    })
    const exit = await startCommand(h.system, repo, h.out(false), parseCliArgs(['start']))
    expect(exit).toBe(2)
    expect(h.written.has(repo.webBuildRecord)).toBe(false)
    // 途中まで書き換わった画面を、前の記録のせいで「組み立て済み」と読まないため。
    expect(h.removed).toEqual([repo.webBuildRecord])
    expect(h.ran.map((r) => r.line)).not.toContain(SERVE)
  })
})

describe('start の引数', () => {
  it('start と --build を読む。--build は既定で付かない', () => {
    expect(parseCliArgs(['start'])).toMatchObject({ command: 'start', build: false })
    expect(parseCliArgs(['start', '--build'])).toMatchObject({ command: 'start', build: true })
  })

  it('知らないオプション・余分な語は今までどおり止める', () => {
    expect(() => parseCliArgs(['start', '--bulid'])).toThrow()
    expect(() => parseCliArgs(['start', 'web'])).toThrow('1 つだけ')
  })
})
