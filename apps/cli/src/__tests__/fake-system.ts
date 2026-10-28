import type { RunResult, System } from '../system.js'

/** テスト用の偽の口。`run` は「コマンドと引数」の文字列で答えを引く。無ければ見つからない扱い。 */
export const fakeSystem = (
  answers: Readonly<Record<string, RunResult>> = {},
  overrides: Partial<System> = {},
): System => ({
  run: (command, args) => Promise.resolve(answers[[command, ...args].join(' ')] ?? { kind: 'not_found' }),
  httpGet: () => Promise.resolve({ ok: false, reason: 'つながりません' }),
  readText: () => Promise.resolve(null),
  writeText: () => Promise.resolve(),
  remove: () => Promise.resolve(),
  exists: () => Promise.resolve(false),
  realpath: (p) => Promise.resolve(p),
  canWrite: () => Promise.resolve(true),
  freeBytes: () => Promise.resolve(null),
  listener: () => Promise.resolve(null),
  redisPing: () => Promise.resolve('つながりません'),
  withDb: () => Promise.reject(Object.assign(new Error('偽の DB'), { code: 'ECONNREFUSED' })),
  randomHex: (bytes) => 'f'.repeat(bytes * 2),
  confirm: () => Promise.resolve(false),
  promptSecret: () => Promise.resolve(null),
  sleep: () => Promise.resolve(),
  nodeVersion: '22.11.0',
  platform: 'darwin',
  homedir: '/Users/me',
  isTty: false,
  progress: () => undefined,
  ...overrides,
})

export const done = (stdout: string): RunResult => ({ kind: 'completed', exitCode: 0, stdout, stderr: '' })
