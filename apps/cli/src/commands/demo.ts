import { z } from 'zod'
import { gatherRuntime } from '../checks/runtime.js'
import { isBlank, type EnvValues } from '../lib/env-file.js'
import { WEB_PORT, portsOf, type RepoPaths } from '../lib/repo.js'
import { formatStep, type Output } from '../printer.js'
import { readEnv } from '../setup/steps.js'
import type { HttpResult, System } from '../system.js'
import type { StepResult } from '../types.js'

/**
 * `pnpm ixa demo`（ADR-0067）。動いている ixa（API）に同梱の見本の作品を入れてもらい、画面の場所を言う。
 * 入れるのは API（`POST /projects/demo`）。ここは頼むだけ。`--json` は 1 つの答え（エージェント向け）。
 *
 * 入り方: 合言葉を決めていなければ、入る口（`POST /auth/login`）は聞かずにクッキーを渡す（この Mac の中だけ）。
 * クッキーで来た書き込みは Origin を見られるので、画面の場所（`CORS_ORIGINS` の先頭）を Origin に付ける。
 * **合言葉を決めていれば入らない**（CLI に合言葉を持たせない）。画面から入れてもらう。
 */

const WEB_URL = `http://localhost:${String(WEB_PORT)}`
const SESSION_COOKIE = 'ixa_session'
const DEFAULT_ORIGIN = 'http://127.0.0.1:3000'
const SHORT_TIMEOUT_MS = 10_000
/** 入れるのに待つ時間の上限（初めては数十 MB を取りに行く）。 */
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000

const noEnv: StepResult = {
  id: 'demo.env',
  status: 'failed',
  message: '.env がありません',
  fix: { hint: '先に導入を済ませる', command: 'pnpm ixa setup', needsHuman: false },
  docs: 'INSTALL.md#設定',
}

const notRunning: StepResult = {
  id: 'demo.running',
  status: 'failed',
  message: 'ixa が動いていません',
  fix: { hint: '先に ixa を起動してから、もう一度 pnpm ixa demo', command: 'pnpm ixa start', needsHuman: false },
  docs: 'INSTALL.md#起動する',
}

const PASSPHRASE_MESSAGE = '合言葉を決めているので、ここからは入れません。画面の『見本を開く』から入れてください'
const UNAVAILABLE_MESSAGE = '見本はまだ用意されていません'

const Envelope = z.union([
  z.object({ success: z.literal(true), data: z.unknown() }),
  z.object({ success: z.literal(false), error: z.string() }),
])
const DemoStatus = z.object({ available: z.boolean(), title: z.string().nullable() })
const DemoInstalled = z.object({ project: z.object({ id: z.string().regex(/^[0-9A-Za-z]+$/), name: z.string() }), created: z.boolean() })

/** 応答の封筒を剥がす。失敗なら API の文（画面に出す前提の日本語）か、短い理由を投げる。 */
const unwrap = <T>(response: HttpResult, schema: z.ZodType<T>, what: string): T => {
  if (!response.ok) throw new Error(`${what}: ${response.reason}`)
  let json: unknown
  try {
    json = JSON.parse(response.body)
  } catch (error) {
    throw new Error(`${what}: 答えが読めませんでした`, { cause: error })
  }
  const envelope = Envelope.safeParse(json)
  if (!envelope.success) throw new Error(`${what}: 答えの形が違います`)
  if (!envelope.data.success) throw new Error(envelope.data.error)
  return schema.parse(envelope.data.data)
}

/** 書き込みの Origin（画面の場所。API は `CORS_ORIGINS` にあるものだけ受ける）。 */
const originOf = (env: EnvValues): string =>
  (env['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .find((origin) => origin !== '') ?? DEFAULT_ORIGIN

const sessionOf = (response: HttpResult): string => {
  if (!response.ok || response.status !== 200) throw new Error('ixa に入れませんでした')
  const cookie = (response.setCookies ?? []).map((line) => line.split(';')[0] ?? '').find((pair) => pair.startsWith(`${SESSION_COOKIE}=`))
  if (cookie === undefined) throw new Error('ixa に入れませんでした（鍵が返りませんでした）')
  return cookie
}

const fail = (out: Output, step: StepResult): number => {
  out.line(formatStep(step))
  out.result({ command: 'demo', ok: false, steps: [step] })
  return 1
}

const failWith = (out: Output, message: string): number => {
  out.line(`✗ ${message}`)
  out.result({ command: 'demo', ok: false, error: message })
  return 1
}

type Session = { readonly api: string; readonly cookie: string; readonly origin: string }

/** 入れる（状態を見て、無ければ断り、あれば頼む）。 */
const installWith = async (system: System, session: Session, workspaceId: string, out: Output): Promise<number> => {
  const status = unwrap(
    await system.httpGet(`${session.api}/projects/demo?workspaceId=${encodeURIComponent(workspaceId)}`, SHORT_TIMEOUT_MS, { cookie: session.cookie }),
    DemoStatus,
    '見本の状態を読めませんでした',
  )
  if (!status.available) return failWith(out, UNAVAILABLE_MESSAGE)
  system.progress('見本を入れています（初めてはファイルを取りに行くので、少しかかります）…')
  const installed = unwrap(
    await system.httpPost(`${session.api}/projects/demo`, JSON.stringify({ workspaceId }), INSTALL_TIMEOUT_MS, {
      cookie: session.cookie,
      origin: session.origin,
      'content-type': 'application/json',
    }),
    DemoInstalled,
    '見本を入れられませんでした',
  )
  const url = `${WEB_URL}/projects/${installed.project.id}`
  out.line(`✓ ${installed.created ? '見本を入れました' : '見本はもう入っています'}: ${url}`)
  out.result({ command: 'demo', ok: true, created: installed.created, title: installed.project.name, url })
  return 0
}

export const demoCommand = async (system: System, repo: RepoPaths, out: Output): Promise<number> => {
  if ((await system.readText(repo.env)) === null) return fail(out, noEnv)
  const env = await readEnv(system, repo)
  if (isBlank(env, 'NEXT_PUBLIC_WORKSPACE_ID')) return fail(out, { ...noEnv, message: '.env の NEXT_PUBLIC_WORKSPACE_ID が空です' })
  const runtime = await gatherRuntime(system, env, repo.root)
  if (runtime.apiHealthy !== true) return fail(out, notRunning)
  if (!isBlank(env, 'IXA_PASSPHRASE')) return failWith(out, PASSPHRASE_MESSAGE)

  const api = `http://127.0.0.1:${String(portsOf(env).api)}`
  const origin = originOf(env)
  const login = await system.httpPost(`${api}/auth/login`, JSON.stringify({ passphrase: '' }), SHORT_TIMEOUT_MS, {
    'content-type': 'application/json',
  })
  const session: Session = { api, cookie: sessionOf(login), origin }
  try {
    return await installWith(system, session, (env['NEXT_PUBLIC_WORKSPACE_ID'] ?? '').trim(), out)
  } catch (error) {
    return failWith(out, error instanceof Error ? error.message : String(error))
  } finally {
    // 使い終えた鍵を取り消す（入るたびに端末の鍵が 1 つ増えるため）。取り消せなくても、鍵は 30 日で切れる。
    const logout = await system.httpPost(`${api}/auth/logout`, '{}', SHORT_TIMEOUT_MS, {
      cookie: session.cookie,
      origin,
      'content-type': 'application/json',
    })
    if (!logout.ok || logout.status !== 200) system.progress('! 使い終えた鍵を取り消せませんでした（鍵は 30 日で切れます）')
  }
}
