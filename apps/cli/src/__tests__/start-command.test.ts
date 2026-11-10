import type { DbClient } from '@ixa/db'
import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../args.js'
import { startCommand } from '../commands/start.js'
import { paths } from '../lib/repo.js'
import type { Output } from '../printer.js'
import { publicEnvHashOf, type PublicEnvSources } from '../start/build-record.js'
import type { Listener, RunOptions, RunResult, System } from '../system.js'
import { markerPath } from '../update/marker.js'
import { done, fakeSystem } from './fake-system.js'

/** `pnpm ixa start`（ADR-0068）。組み立て済みの画面と、見張らない api・worker・音の解析を起こす。 */

const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)
const SECRET = 'f'.repeat(64)
const ENV = [
  'DATABASE_URL=postgresql://ixa:pw@127.0.0.1:5432/ixa',
  'REDIS_URL=redis://127.0.0.1:6379',
  `STORAGE_SIGNING_SECRET=${SECRET}`,
  'NEXT_PUBLIC_API_URL=http://127.0.0.1:3001',
  'NEXT_PUBLIC_WORKSPACE_ID=01WS',
  '',
].join('\n')
const repo = paths('/repo')
const ROOT_PACKAGE = JSON.stringify({ name: 'ixa-video-creator', version: '0.8.4' })

const BUILD = 'pnpm --filter @ixa/web run build:start'
const SERVE = 'pnpm exec turbo run serve'
const REV_PARSE = 'git rev-parse HEAD'

/** 直下の `.env` だけから決まる指紋（ほかの読む先が空のとき）。 */
const NO_SOURCES: PublicEnvSources = { processEnv: {}, webEnvProductionLocal: {}, webEnvLocal: {}, webEnvProduction: {}, webEnv: {}, rootEnv: {} }
const ROOT_PUBLIC = { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001', NEXT_PUBLIC_WORKSPACE_ID: '01WS' }
const recordFor = (commit: string): string => JSON.stringify({ commit, publicEnv: publicEnvHashOf({ ...NO_SOURCES, rootEnv: ROOT_PUBLIC }) })

/** DB の更新が全部当たっていて、ワークスペースの表が読める偽の DB（doctor の db.* が ✓ になる分だけ）。 */
const migratedDb = {
  execute: () => Promise.resolve([{ present: true, last: Number.MAX_SAFE_INTEGER }]),
  select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
} as unknown as DbClient

type Harness = {
  readonly files?: Readonly<Record<string, string>>
  readonly answers?: Readonly<Record<string, RunResult>>
  readonly listeners?: Readonly<Record<number, Listener>>
  readonly overrides?: Partial<System>
}

const harness = ({ files = {}, answers = {}, listeners = {}, overrides = {} }: Harness) => {
  const store = new Map<string, string>(Object.entries({ [repo.rootPackage]: ROOT_PACKAGE, ...files }))
  const written = new Map<string, string>()
  const removed: string[] = []
  const ran: { readonly line: string; readonly options: RunOptions | undefined; readonly files: ReadonlySet<string> }[] = []
  const lines: string[] = []
  const results: unknown[] = []
  const system = fakeSystem(
    {},
    {
      run: (command, args, options) => {
        const line = [command, ...args].join(' ')
        // 動かした瞬間にあったファイルを残す（「組み立ての前に記録が消えていたか」「組み立ての間に印があったか」を見る）。
        ran.push({ line, options, files: new Set(store.keys()) })
        return Promise.resolve(answers[line] ?? { kind: 'not_found' })
      },
      readText: (p) => Promise.resolve(store.get(p) ?? null),
      writeText: (p, c) => Promise.resolve(void (store.set(p, c), written.set(p, c))),
      createText: (p, c) => Promise.resolve(store.has(p) ? false : (store.set(p, c), written.set(p, c), true)),
      remove: (p) => Promise.resolve(void (store.delete(p), removed.push(p))),
      listener: (port) => Promise.resolve(listeners[port] ?? null),
      withDb: (_url, body) => body(migratedDb),
      redisPing: () => Promise.resolve(true),
      ...overrides,
    },
  )
  const out = (json: boolean): Output => ({ json, line: (t) => lines.push(t), result: (p) => results.push(p) })
  const lineOf = (target: string) => ran.find((r) => r.line === target)
  const started = () => ran.map((r) => r.line).filter((l) => l === BUILD || l === SERVE)
  return { system, store, written, removed, ran, lines, results, out, lineOf, started }
}

const thisRepo = (cwd: string): Listener => ({ pid: 10, cwd })
const ALL_UP = { 3000: thisRepo('/repo/apps/web'), 3001: thisRepo('/repo/apps/api'), 8100: thisRepo('/repo/apps/audio') }
const READY: Readonly<Record<string, RunResult>> = { [REV_PARSE]: done(`${COMMIT_A}\n`), [BUILD]: done(''), [SERVE]: done('') }

describe('startCommand（起こす前に止める）', () => {
  it('更新が途中で止まっていれば、何より先に止めて続きを勧める（--json でも）', async () => {
    const marker = JSON.stringify({ from: '0.8.3', to: '0.8.4', ref: 'v0.8.4', main: false, at: '2026-11-10T00:00:00Z' })
    for (const json of [false, true]) {
      const h = harness({ files: { [markerPath(repo)]: marker, [repo.env]: ENV }, answers: READY })
      expect(await startCommand(h.system, repo, h.out(json), parseCliArgs(json ? ['start', '--json'] : ['start']))).toBe(1)
      expect(h.started()).toEqual([])
      expect(h.results[0]).toMatchObject({ command: 'start', ok: false, steps: [{ id: 'update.pending', fix: { command: 'pnpm -s ixa update --resume' } }] })
    }
  })

  it('.env が無ければ何も起こさず setup を勧める', async () => {
    const h = harness({ answers: READY })
    expect(await startCommand(h.system, repo, h.out(false), parseCliArgs(['start']))).toBe(1)
    expect(h.started()).toEqual([])
    expect(h.lines.join('\n')).toContain('pnpm ixa setup')
  })

  it('全部この clone のものなら、何も起こさず場所だけ言う（--json でも答える）', async () => {
    for (const json of [false, true]) {
      const h = harness({ files: { [repo.env]: ENV }, listeners: ALL_UP, answers: READY })
      expect(await startCommand(h.system, repo, h.out(json), parseCliArgs(json ? ['start', '--json'] : ['start']))).toBe(0)
      expect(h.started()).toEqual([])
      expect(h.written.size).toBe(0)
      expect(h.results[0]).toMatchObject({ command: 'start', ok: true, running: true, url: 'http://localhost:3000' })
    }
  })

  it('動いているのに --build なら、組み立て直していないと言って 1 で返る', async () => {
    const h = harness({ files: { [repo.env]: ENV }, listeners: ALL_UP, answers: READY })
    expect(await startCommand(h.system, repo, h.out(true), parseCliArgs(['start', '--build']))).toBe(1)
    expect(h.started()).toEqual([])
    expect(h.results[0]).toMatchObject({ ok: false, steps: [{ id: 'start.running' }] })
    expect(JSON.stringify(h.results[0])).toContain('Ctrl+C で止めてから pnpm ixa start --build')
  })

  it('一部だけ動いていれば（音の解析だけ残っている）成功と言わず、動いているもの・いないものを名前で言う', async () => {
    const h = harness({ files: { [repo.env]: ENV }, listeners: { 8100: thisRepo('/repo/apps/audio') }, answers: READY })
    expect(await startCommand(h.system, repo, h.out(true), parseCliArgs(['start']))).toBe(1)
    expect(h.started()).toEqual([])
    const step = (h.results[0] as { steps: readonly { id: string; message: string; fix: { command?: string } }[] }).steps[0]
    expect(step?.id).toBe('start.partial')
    expect(step?.message).toContain('動いている: 音の解析')
    expect(step?.message).toContain('動いていない: 画面（web）・API')
    expect(step?.fix.command).toBe('lsof -nP -iTCP:8100 -sTCP:LISTEN')
  })

  it('ポートを別のものが使っていれば起こさない（起動してから落ちるのを先に止める）', async () => {
    const h = harness({ files: { [repo.env]: ENV }, listeners: { 3001: { pid: 77, cwd: '/somewhere/else' } }, answers: READY })
    expect(await startCommand(h.system, repo, h.out(true), parseCliArgs(['start']))).toBe(1)
    expect(h.started()).toEqual([])
    expect(h.results[0]).toMatchObject({ command: 'start', ok: false, results: [{ id: 'runtime.port-api', level: 'fail' }] })
  })

  it('DB につながらない・設定の形が違うなら、組み立てる前に doctor の文で止める', async () => {
    const down = harness({
      files: { [repo.env]: ENV },
      answers: READY,
      overrides: { redisPing: () => Promise.resolve('つながりません'), withDb: () => Promise.reject(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })) },
    })
    expect(await startCommand(down.system, repo, down.out(true), parseCliArgs(['start']))).toBe(1)
    expect(down.started()).toEqual([])
    expect(down.results[0]).toMatchObject({ results: [{ id: 'db.postgres', level: 'fail' }, { id: 'db.redis', level: 'fail' }] })

    const invalid = harness({ files: { [repo.env]: ENV.replace(`STORAGE_SIGNING_SECRET=${SECRET}`, 'STORAGE_SIGNING_SECRET=short') }, answers: READY })
    expect(await startCommand(invalid.system, repo, invalid.out(true), parseCliArgs(['start']))).toBe(1)
    expect(invalid.started()).toEqual([])
    expect(invalid.results[0]).toMatchObject({ results: [{ id: 'env.valid', level: 'fail' }] })
  })

  it('--json では起動しない（止めるまで返らないため）。後ろで起こして doctor で見る、と答える', async () => {
    const h = harness({ files: { [repo.env]: ENV }, answers: READY })
    expect(await startCommand(h.system, repo, h.out(true), parseCliArgs(['start', '--json']))).toBe(1)
    expect(h.started()).toEqual([])
    expect(h.results[0]).toMatchObject({ command: 'start', ok: false, running: false })
    expect(JSON.stringify(h.results[0])).toContain('pnpm -s ixa doctor --json')
  })

  it('ほかの start が組み立てている最中（持ち主が生きている印）なら、組み立ても起動もしない', async () => {
    const lock = JSON.stringify({ pid: 999, startedAt: '2026-11-10T09:00:00.000Z' })
    const h = harness({ files: { [repo.env]: ENV, [repo.webBuildLock]: lock }, answers: READY, overrides: { pidAlive: (pid) => pid === 999 } })
    expect(await startCommand(h.system, repo, h.out(false), parseCliArgs(['start', '--build']))).toBe(1)
    expect(h.started()).toEqual([])
    expect(h.store.get(repo.webBuildLock)).toBe(lock)
    expect(h.lines.join('\n')).toContain('画面を組み立てている最中です')
  })
})

describe('startCommand（組み立てと起動）', () => {
  it('組み立てが要らなければ、そのまま serve を端末につないで起こし、その終了コードを返す', async () => {
    // 終了コードは偽の run が返した値をそのまま返すことだけを見る（Ctrl+C で子が本当に返すかは real-system.test.ts）。
    const h = harness({
      files: { [repo.env]: ENV, [repo.webBuildRecord]: recordFor(COMMIT_A) },
      answers: { ...READY, [SERVE]: { kind: 'completed', exitCode: 3, stdout: '', stderr: '' } },
    })
    expect(await startCommand(h.system, repo, h.out(false), parseCliArgs(['start']))).toBe(3)
    expect(h.started()).toEqual([SERVE])
    expect(h.lineOf(SERVE)?.options).toMatchObject({ cwd: '/repo', inherit: 'all' })
  })

  it('版が変わっていれば、前の記録を消し・印を持って組み立て、済んでから記録を書き・印を外して serve を起こす', async () => {
    const h = harness({ files: { [repo.env]: ENV, [repo.webBuildRecord]: recordFor(COMMIT_A) }, answers: { ...READY, [REV_PARSE]: done(`${COMMIT_B}\n`) } })
    expect(await startCommand(h.system, repo, h.out(false), parseCliArgs(['start']))).toBe(0)
    expect(h.started()).toEqual([BUILD, SERVE])
    const build = h.lineOf(BUILD)
    expect(build?.options).toMatchObject({ cwd: '/repo', inherit: 'all' })
    expect(build?.files.has(repo.webBuildRecord)).toBe(false)
    expect(build?.files.has(repo.webBuildLock)).toBe(true)
    expect(h.lineOf(SERVE)?.files.has(repo.webBuildLock)).toBe(false)
    expect(JSON.parse(h.store.get(repo.webBuildRecord) ?? '{}')).toMatchObject({ commit: COMMIT_B })
    expect(JSON.parse(h.written.get(repo.webBuildLock) ?? '{}')).toMatchObject({ pid: 4242 })
    expect(h.lines.join('\n')).toContain('数分')
  })

  it('--build なら記録が合っていても組み立てる', async () => {
    const h = harness({ files: { [repo.env]: ENV, [repo.webBuildRecord]: recordFor(COMMIT_A) }, answers: READY })
    expect(await startCommand(h.system, repo, h.out(false), parseCliArgs(['start', '--build']))).toBe(0)
    expect(h.started()).toEqual([BUILD, SERVE])
  })

  it('読めない記録は組み立て直し、その理由を言う（黙って捨てない）', async () => {
    const h = harness({ files: { [repo.env]: ENV, [repo.webBuildRecord]: '{' }, answers: READY })
    expect(await startCommand(h.system, repo, h.out(false), parseCliArgs(['start']))).toBe(0)
    expect(h.started()).toEqual([BUILD, SERVE])
    expect(h.lines.join('\n')).toContain('記録（apps/web/.next-start/ixa-build.json）が読めません')
  })

  it('死んだ持ち主の印は理由を言って消し、組み立てる', async () => {
    const lock = JSON.stringify({ pid: 999, startedAt: '2026-11-10T09:00:00.000Z' })
    const h = harness({ files: { [repo.env]: ENV, [repo.webBuildLock]: lock }, answers: READY })
    expect(await startCommand(h.system, repo, h.out(false), parseCliArgs(['start']))).toBe(0)
    expect(h.started()).toEqual([BUILD, SERVE])
    expect(h.lines.join('\n')).toContain('pid 999）はもう動いていません')
    expect(h.store.has(repo.webBuildLock)).toBe(false)
  })

  it('組み立てに失敗したら記録を書かず（前の記録も消す）、印も外し、serve を起こさず、その終了コードで返る', async () => {
    const h = harness({
      files: { [repo.env]: ENV, [repo.webBuildRecord]: recordFor(COMMIT_A) },
      answers: { ...READY, [REV_PARSE]: done(`${COMMIT_B}\n`), [BUILD]: { kind: 'completed', exitCode: 2, stdout: '', stderr: '' } },
    })
    expect(await startCommand(h.system, repo, h.out(false), parseCliArgs(['start']))).toBe(2)
    expect(h.store.has(repo.webBuildRecord)).toBe(false)
    expect(h.store.has(repo.webBuildLock)).toBe(false)
    expect(h.started()).toEqual([BUILD])
  })

  it('組み立てが投げても印は外す', async () => {
    const h = harness({
      files: { [repo.env]: ENV },
      answers: READY,
      overrides: {
        run: (command, args) =>
          [command, ...args].join(' ') === BUILD ? Promise.reject(new Error('落ちた')) : Promise.resolve(READY[[command, ...args].join(' ')] ?? { kind: 'not_found' }),
      },
    })
    await expect(startCommand(h.system, repo, h.out(false), parseCliArgs(['start']))).rejects.toThrow('落ちた')
    expect(h.store.has(repo.webBuildLock)).toBe(false)
  })

  it('組み立てを起こしたプロセスの NEXT_PUBLIC_* が前と違えば組み立て直す（LAN の URL のまま残さない）', async () => {
    const h = harness({
      files: { [repo.env]: ENV, [repo.webBuildRecord]: recordFor(COMMIT_A) },
      answers: READY,
      overrides: { processEnv: { NEXT_PUBLIC_API_URL: 'http://mac.local:3001' } },
    })
    expect(await startCommand(h.system, repo, h.out(false), parseCliArgs(['start']))).toBe(0)
    expect(h.started()).toEqual([BUILD, SERVE])
    expect(h.lines.join('\n')).toContain('NEXT_PUBLIC_*')
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
