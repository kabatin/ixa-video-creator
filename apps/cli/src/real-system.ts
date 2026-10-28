import { spawn, type StdioOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, readFile, realpath, rm, statfs, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { closeDbClient, createDbClient } from '@ixa/db'
import type { HttpResult, Listener, RunOptions, RunResult, System } from './system.js'

/** 何も指定しないときのコマンドの打ち切り。docker や git が固まっても点検は返す。 */
const DEFAULT_RUN_TIMEOUT_MS = 20_000

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined

/** `to-stderr` は子の stdout も fd 2（stderr）へ流す。 */
const stdioFor = (inherit: RunOptions['inherit']): StdioOptions => {
  if (inherit === 'all') return 'inherit'
  if (inherit === 'to-stderr') return ['inherit', 2, 2]
  return ['ignore', 'pipe', 'pipe']
}

const run = (command: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> =>
  new Promise((resolve) => {
    const timeoutMs = options.inherit === undefined ? (options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS) : options.timeoutMs
    const child = spawn(command, [...args], { cwd: options.cwd, stdio: stdioFor(options.inherit) })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
    let timedOut = false
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
          }, timeoutMs)
    child.on('error', (error: Error) => {
      clearTimeout(timer)
      resolve(errorCode(error) === 'ENOENT' ? { kind: 'not_found' } : { kind: 'spawn_failed', reason: error.message })
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      if (timedOut) return resolve({ kind: 'timeout' })
      resolve({
        kind: 'completed',
        exitCode: code ?? 1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      })
    })
  })

const httpGet = async (
  url: string,
  timeoutMs: number,
  headers: Readonly<Record<string, string>> = {},
): Promise<HttpResult> => {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
    return { ok: true, status: response.status, body: await response.text() }
  } catch (error) {
    // 理由に URL は入れない（トークンを URL に入れる設定でも漏れないように）。
    return { ok: false, reason: error instanceof Error && error.name === 'TimeoutError' ? '応答がありません' : 'つながりません' }
  }
}

const readText = async (file: string): Promise<string | null> => {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw new Error(`${file} を読めませんでした: ${String(error)}`, { cause: error })
  }
}

const exists = async (file: string): Promise<boolean> => {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

/** いちばん近い、実在する親。 */
const nearestExisting = async (file: string): Promise<string> => {
  const parent = path.dirname(file)
  if ((await exists(file)) || parent === file) return file
  return nearestExisting(parent)
}

const canWrite = async (file: string): Promise<boolean> => {
  try {
    await access(await nearestExisting(file), constants.W_OK)
    return true
  } catch {
    return false
  }
}

const freeBytes = async (file: string): Promise<number | null> => {
  try {
    const stats = await statfs(await nearestExisting(file))
    return stats.bavail * stats.bsize
  } catch {
    return null
  }
}

/** `lsof -F` の 1 行目の値（`p123` → `123`）。 */
const lsofField = (stdout: string, field: string): string | null =>
  stdout
    .split('\n')
    .find((line) => line.startsWith(field))
    ?.slice(1) ?? null

const listener = async (port: number): Promise<Listener | null> => {
  const found = await run('lsof', ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-Fp'])
  if (found.kind !== 'completed' || found.exitCode !== 0) return null
  const pid = Number(lsofField(found.stdout, 'p'))
  if (!Number.isInteger(pid) || pid <= 0) return null
  const cwd = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
  return { pid, cwd: cwd.kind === 'completed' ? lsofField(cwd.stdout, 'n') : null }
}

const redisPing = (url: string, timeoutMs: number): Promise<true | string> =>
  new Promise((resolve) => {
    const parsed = new URL(url)
    const socket = connect({ host: parsed.hostname, port: Number(parsed.port || 6379) })
    const done = (result: true | string): void => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs, () => done('応答がありません'))
    socket.on('error', () => done('つながりません'))
    socket.on('connect', () => {
      const password = decodeURIComponent(parsed.password)
      if (password !== '') socket.write(`AUTH ${password}\r\n`)
      socket.write('PING\r\n')
    })
    socket.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (text.includes('+PONG')) done(true)
      else if (text.startsWith('-')) done('PING に答えません（合言葉が違うかもしれません）')
    })
  })

const withDb = async <T>(url: string, body: (db: ReturnType<typeof createDbClient>) => Promise<T>): Promise<T> => {
  const db = createDbClient(url, { maxConnections: 1, connectTimeoutSec: 3, silenceNotices: true })
  try {
    return await body(db)
  } finally {
    await closeDbClient(db)
  }
}

const confirm = async (question: string): Promise<boolean> => {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = await rl.question(`${question} [Y/n] `)
    return answer.trim() === '' || /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

const CTRL_C = '\u0003'
const BACKSPACES = new Set(['\u007f', '\b'])

/** `promptSecret` が使う stdin の口（テストは偽物を渡す）。 */
export type SecretInput = Pick<NodeJS.ReadStream, 'isTTY' | 'setRawMode' | 'setEncoding' | 'resume' | 'pause' | 'on' | 'off' | 'once'>

/** 打った文字を出さずに 1 行読む（raw モード）。貼り付けもそのまま受ける。stdin が閉じたら null（待ち続けない）。 */
export const readSecretLine = (input: SecretInput, write: (text: string) => void, question: string): Promise<string | null> => {
  if (!input.isTTY) return Promise.resolve(null)
  write(question)
  return new Promise((resolve) => {
    let typed = ''
    const onEnd = (): void => finish(null)
    const finish = (result: string | null): void => {
      input.off('data', onData)
      input.off('end', onEnd)
      input.setRawMode(false)
      input.pause()
      write('\n')
      resolve(result)
    }
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish(typed)
        if (ch === CTRL_C) return finish(null)
        if (BACKSPACES.has(ch)) typed = typed.slice(0, -1)
        else if (ch >= ' ') typed = `${typed}${ch}`
      }
    }
    input.setEncoding('utf8')
    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
    input.once('end', onEnd)
  })
}

const promptSecret = (question: string): Promise<string | null> =>
  readSecretLine(process.stdin, (text) => process.stderr.write(text), question)

const readStdin = async (): Promise<string | null> => {
  if (process.stdin.isTTY) return null
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text === '' ? null : text
}

export const createRealSystem = (): System => ({
  run,
  httpGet,
  readText,
  writeText: (file, content) => writeFile(file, content, 'utf8'),
  remove: (file) => rm(file, { force: true }),
  exists,
  realpath: async (file) => {
    try {
      return await realpath(file)
    } catch {
      return file
    }
  },
  canWrite,
  freeBytes,
  listener,
  redisPing,
  withDb,
  randomHex: (bytes) => randomBytes(bytes).toString('hex'),
  confirm,
  promptSecret,
  readStdin,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  nodeVersion: process.versions.node,
  platform: process.platform,
  homedir: os.homedir(),
  isTty: process.stdout.isTTY,
  progress: (line) => {
    process.stderr.write(`${line}\n`)
  },
})
