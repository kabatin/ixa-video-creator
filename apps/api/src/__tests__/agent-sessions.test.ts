import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenAPIHono } from '@hono/zod-openapi'
import { aShot } from '@ixa/generation/testing'
import type { AgentSession, AiToolId } from '@ixa/domain'
import { afterAll, describe, expect, it } from 'vitest'
import { createAgentHub } from '../agent/agent-hub.js'
import { createAgentService, NOT_CLAUDE_MESSAGE, OTHER_TASK_BUSY_MESSAGE } from '../agent/agent-service.js'
import { AGENT_KEY_LABEL_PREFIX } from '../agent/agent-turn-setup.js'
import { registerErrorHandlers } from '../errors.js'
import { createLogger } from '../logger.js'
import { agentApprovalRoutes } from '../routes/agent-approvals.js'
import { agentSessionRoutes } from '../routes/agent-sessions.js'
import { createFakeCli, cliLines, exited, type FakeCliCall } from './fake-cli-stream.js'
import { aProject } from './fixtures.js'
import { createInMemoryAccessTokens } from './in-memory-access-token-repository.js'
import { createInMemoryAgentSessions, type InMemoryAgentSessions } from './in-memory-agent-sessions.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * AI エージェントの会話（ADR-0058）。偽の CLI（決まった stream-json を返す）で、やりとりの流れ・確認の待ちと答え・
 * 止める・起動時の中断・鍵の取り消し・2 つ目の会話を断ること、を確かめる。本物の CLI は叩かない。
 */

const CLI_SESSION = '6a4a65e2-1d81-49ef-add0-13d11b944480'
const roots: string[] = []
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })))

type SetupOptions = {
  readonly textTool?: AiToolId
  /** 会話の表の口を差し替える（後片付けの失敗を作る）。 */
  readonly wrapSessions?: (repo: InMemoryAgentSessions) => InMemoryAgentSessions
  /** 残った CLI のうち、本物のエージェントの CLI とみなす番号。 */
  readonly agentPids?: readonly number[]
  /** 時計（確認の期限を確かめる）。 */
  readonly now?: () => Date
  /** 作業場所の親を差し替える（作れない場所を渡して、始める途中の失敗を作る）。 */
  readonly sessionsRoot?: string
}

const setup = (script: (call: FakeCliCall, app: OpenAPIHono) => Promise<ReturnType<typeof exited>>, opts: SetupOptions = {}) => {
  const project = aProject()
  const shot = aShot(project.id, { code: 'CUT-07' })
  const projects = createInMemoryProjectRepository([project])
  const sessions = (opts.wrapSessions ?? ((repo) => repo))(createInMemoryAgentSessions())
  const tokens = createInMemoryAccessTokens()
  const logger = createLogger('silent')
  const hub = createAgentHub(() => undefined)
  const root = mkdtempSync(join(tmpdir(), 'ixa-agent-'))
  roots.push(root)
  const app = new OpenAPIHono()
  const cli = createFakeCli((call) => script(call, app))
  const killed: number[] = []
  const agent = createAgentService({
    sessions,
    projects,
    shots: { findById: (id) => Promise.resolve(id === shot.id ? shot : null) },
    tokens,
    hub,
    runner: cli.runner,
    textTool: () => Promise.resolve(opts.textTool ?? 'claude_cli'),
    defaultModel: 'claude-sonnet-5-5',
    cli: {
      command: 'claude',
      mcpCommand: '/repo/apps/mcp/node_modules/.bin/tsx',
      mcpArgs: ['/repo/apps/mcp/src/main.ts'],
      apiUrl: 'http://127.0.0.1:3001',
      sessionsRoot: opts.sessionsRoot ?? root,
      baseEnv: { PATH: '/usr/bin', HOME: '/Users/me', DATABASE_URL: 'postgres://secret', FAL_API_KEY: 'secret' },
    },
    now: opts.now ?? (() => new Date()),
    logger,
    processes: {
      isAgentCli: (pid) => Promise.resolve((opts.agentPids ?? []).includes(pid)),
      killGroup: (pid) => {
        killed.push(pid)
      },
    },
  })
  registerErrorHandlers(app, logger)
  app.route('/', agentSessionRoutes({ agent, sessions, projects }))
  app.route('/', agentApprovalRoutes({ agent }))
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const newTask = async (): Promise<AgentSession['id']> => {
    const res = await post(`/projects/${project.id}/agent-sessions`, {})
    expect(res.status).toBe(201)
    return ((await res.json()) as { data: { id: AgentSession['id'] } }).data.id
  }
  const statusOf = (id: AgentSession['id']) => sessions.all().find((s) => s.id === id)?.status
  const until = async (check: () => boolean, what: string): Promise<void> => {
    const deadline = Date.now() + 2000
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`待ちきれませんでした: ${what}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  return { app, agent, project, shot, sessions, tokens, cli, root, post, newTask, statusOf, until, killed }
}

const simpleTurn = (call: FakeCliCall) => {
  call.emit(cliLines.init(CLI_SESSION))
  call.emit({ type: 'rate_limit_event', session_id: CLI_SESSION })
  call.emit(cliLines.text(CLI_SESSION, '## 直しました\n0:03 のテロップを変えました'))
  call.emit(cliLines.result(CLI_SESSION, 0.25))
  return Promise.resolve(exited(0))
}

describe('やりとりの流れ', () => {
  it('話すと CLI を起こし、流れた行を会話に残し、済みにする。費用と要約を記録し、鍵を取り消し、設定ファイルを消す', async () => {
    const t = setup(simpleTurn)
    const id = await t.newTask()
    const res = await t.post(`/agent-sessions/${id}/messages`, {
      text: 'この Shot のテロップを「優勝」に',
      context: { shotId: t.shot.id, playheadSec: 3.75 },
    })
    expect(res.status).toBe(202)
    await t.until(() => t.statusOf(id) === 'idle', '済み')

    const session = t.sessions.all().find((s) => s.id === id)
    expect(session).toMatchObject({
      title: 'この Shot のテロップを「優勝」に',
      cliSessionId: CLI_SESSION,
      costUsd: 0.25,
      lastSummary: '直しました',
    })
    expect(t.sessions.messages(id).map((m) => m.body.kind)).toEqual(['user', 'system', 'system', 'assistant_text', 'turn_end'])
    expect(t.sessions.messages(id)[0]?.body).toEqual({
      kind: 'user',
      text: 'この Shot のテロップを「優勝」に',
      context: { shotLabel: 'CUT-07', playheadSec: 3.75 },
    })

    const call = t.cli.calls[0]
    expect(call?.invocation.args).toContain('claude-sonnet-5-5')
    expect(call?.invocation.args).not.toContain('--resume')
    expect(call?.invocation.cwd).toBe(join(t.root, id))
    expect(call?.invocation.stdin).toContain(t.project.name)
    expect(call?.invocation.stdin).toContain('CUT-07')
    expect(call?.invocation.stdin).toContain('0:03.75')
    expect(call?.invocation.env).toEqual({ PATH: '/usr/bin', HOME: '/Users/me' })

    const [key] = t.tokens.rows()
    expect(key?.label.startsWith(AGENT_KEY_LABEL_PREFIX)).toBe(true)
    expect(key?.revokedAt).not.toBeNull()
    expect(key?.expiresAt).not.toBeNull()
    const configPath = call?.invocation.args[call.invocation.args.indexOf('--mcp-config') + 1] ?? ''
    expect(existsSync(configPath)).toBe(false)
    // 鍵そのものは会話の行に入らない。
    expect(JSON.stringify(t.sessions.messages(id))).not.toContain('secret')
  })

  it('MCP の設定ファイルは権限 600 で、env には鍵・作品のワークスペース・会話があり、DB の鍵は無い', async () => {
    const seen: { mode?: number; env?: Readonly<Record<string, string>> } = {}
    const t = setup((call) => {
      const path = call.invocation.args[call.invocation.args.indexOf('--mcp-config') + 1] ?? ''
      seen.mode = statSync(path).mode & 0o777
      seen.env = call.mcpEnv()
      return simpleTurn(call)
    })
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: 'こんにちは' })
    await t.until(() => t.statusOf(id) === 'idle', '済み')
    expect(seen.mode).toBe(0o600)
    expect(seen.env).toMatchObject({
      IXA_API_URL: 'http://127.0.0.1:3001',
      IXA_WORKSPACE_ID: t.project.workspaceId,
      IXA_AGENT_SESSION_ID: id,
    })
    expect(seen.env?.['IXA_API_TOKEN']?.length).toBeGreaterThan(20)
    expect(seen.env).not.toHaveProperty('DATABASE_URL')
  })

  it('2 回目は同じ作業場所で --resume する。題名は最初の依頼のまま', async () => {
    const t = setup(simpleTurn)
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: '最初の依頼' })
    await t.until(() => t.statusOf(id) === 'idle', '1 回目')
    await t.post(`/agent-sessions/${id}/messages`, { text: '続き' })
    await t.until(() => t.cli.calls.length === 2 && t.statusOf(id) === 'idle', '2 回目')
    const args = t.cli.calls[1]?.invocation.args ?? []
    expect(args.slice(-2)).toEqual(['--resume', CLI_SESSION])
    expect(t.cli.calls[1]?.invocation.cwd).toBe(t.cli.calls[0]?.invocation.cwd)
    expect(t.sessions.all()[0]?.title).toBe('最初の依頼')
  })

  it('CLI が終わりの行を出さずに終わったら失敗にし、理由を会話に残す', async () => {
    const t = setup((call) => {
      call.emit(cliLines.init(CLI_SESSION))
      return Promise.resolve({ kind: 'exited', exitCode: 1, signal: null, stderrTail: 'boom' })
    })
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: 'こんにちは' })
    await t.until(() => t.statusOf(id) === 'error', '失敗')
    const last = t.sessions.messages(id).at(-1)?.body
    expect(last).toMatchObject({ kind: 'system', event: 'failed' })
    expect(t.tokens.rows()[0]?.revokedAt).not.toBeNull()
  })

  it('テキストの AI が Claude でなければ始めず、理由を返す', async () => {
    const t = setup(simpleTurn, { textTool: 'codex_cli' })
    const id = await t.newTask()
    const res = await t.post(`/agent-sessions/${id}/messages`, { text: 'こんにちは' })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: string }).error).toBe(NOT_CLAUDE_MESSAGE)
    expect(t.cli.calls).toHaveLength(0)
    expect(t.statusOf(id)).toBe('idle')
  })
})

describe('始める途中の失敗', () => {
  it('鍵を発行したあとで失敗したら、鍵を取り消し、失敗にする', async () => {
    const blocker = join(mkdtempSync(join(tmpdir(), 'ixa-agent-file-')), 'not-a-dir')
    writeFileSync(blocker, 'x')
    const t = setup(simpleTurn, { sessionsRoot: blocker })
    const id = await t.newTask()
    const res = await t.post(`/agent-sessions/${id}/messages`, { text: 'こんにちは' })
    expect(res.status).toBe(500)
    expect(t.tokens.rows()).toHaveLength(1)
    expect(t.tokens.rows()[0]?.revokedAt).not.toBeNull()
    expect(t.statusOf(id)).toBe('error')
    expect(t.cli.calls).toHaveLength(0)
  })
})

describe('1 作品 1 動作', () => {
  it('同じ作品で別のタスクが作業中なら、2 つ目は断る', async () => {
    const t = setup(async (call) => {
      await call.untilStopped()
      return exited(143)
    })
    const a = await t.newTask()
    const b = await t.newTask()
    await t.post(`/agent-sessions/${a}/messages`, { text: 'A' })
    await t.until(() => t.statusOf(a) === 'running', 'A が作業中')
    const res = await t.post(`/agent-sessions/${b}/messages`, { text: 'B' })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe(OTHER_TASK_BUSY_MESSAGE)
    await t.post(`/agent-sessions/${a}/stop`, {})
    await t.until(() => t.statusOf(a) === 'interrupted', 'A が中断')
  })
})

describe('止める', () => {
  it('止めると CLI を止め、中断にして、そのことを会話に残す。鍵も取り消す', async () => {
    const t = setup(async (call) => {
      call.emit(cliLines.init(CLI_SESSION))
      await call.untilStopped()
      return exited(143)
    })
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: 'ゆっくりやって' })
    await t.until(() => t.statusOf(id) === 'running', '作業中')
    expect((await t.post(`/agent-sessions/${id}/stop`, {})).status).toBe(202)
    await t.until(() => t.statusOf(id) === 'interrupted', '中断')
    expect(t.cli.calls[0]?.stopped()).toBe(true)
    expect(t.sessions.messages(id).at(-1)?.body).toMatchObject({ kind: 'system', event: 'interrupted' })
    expect(t.tokens.rows()[0]?.revokedAt).not.toBeNull()
    // 作業中でなければ止められない。
    expect((await t.post(`/agent-sessions/${id}/stop`, {})).status).toBe(409)
  })
})

describe('確認の待ちと答え', () => {
  /** MCP の approve の代わり。そのやりとりの鍵で確認の口を呼び、答えが来るまで待つ。 */
  const approveVia = async (app: OpenAPIHono, call: FakeCliCall, sessionId: string, body: unknown): Promise<string> => {
    const auth = { authorization: `Bearer ${call.mcpToken()}`, 'content-type': 'application/json' }
    const started = (await (
      await app.request(`/agent-sessions/${sessionId}/approvals`, { method: 'POST', headers: auth, body: JSON.stringify(body) })
    ).json()) as { data: { requestId: string; decision: string | null } }
    let decision = started.data.decision
    while (decision === null) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      const state = (await (
        await app.request(`/agent-sessions/${sessionId}/approvals/${started.data.requestId}`, { headers: auth })
      ).json()) as { data: { decision: string | null } }
      decision = state.data.decision
    }
    return decision
  }

  const generating = (decisions: string[]) => async (call: FakeCliCall, app: OpenAPIHono) => {
    const sessionId = call.mcpEnv()['IXA_AGENT_SESSION_ID'] ?? ''
    call.emit(cliLines.init(CLI_SESSION))
    call.emit(cliLines.toolUse(CLI_SESSION, 'toolu_1', 'mcp__ixa__generate_sfx', { cues: [] }))
    const decision = await approveVia(app, call, sessionId, {
      toolName: 'mcp__ixa__generate_sfx',
      toolUseId: 'toolu_1',
      risk: 'costly',
      input: { cues: [] },
    })
    decisions.push(decision)
    call.emit(cliLines.toolResult(CLI_SESSION, 'toolu_1', decision === 'allow' ? '置きました' : '制作者がやめました', decision !== 'allow'))
    call.emit(cliLines.result(CLI_SESSION, 0.1))
    return exited(0)
  }

  it('費用が掛かる操作は確認待ちになり、画面が「実行」と答えると続ける。直した数に数える', async () => {
    const decisions: string[] = []
    const t = setup(generating(decisions))
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: '効果音を 1 本' })
    await t.until(() => t.statusOf(id) === 'awaiting_approval', '確認待ち')
    const request = t.sessions.messages(id).find((m) => m.body.kind === 'approval_request')?.body
    expect(request).toMatchObject({ kind: 'approval_request', toolName: 'mcp__ixa__generate_sfx', risk: 'costly', toolUseId: 'toolu_1' })
    const requestId = request?.kind === 'approval_request' ? request.requestId : ''

    // エージェント自身（Bearer）は答えられない。
    const byBearer = await t.post(`/agent-sessions/${id}/approvals/${requestId}`, { decision: 'allow' }, {
      authorization: `Bearer ${t.cli.calls[0]?.mcpToken() ?? ''}`,
    })
    expect(byBearer.status).toBe(403)

    const answer = await t.post(`/agent-sessions/${id}/approvals/${requestId}`, { decision: 'allow' }, { cookie: 'ixa_session=x' })
    expect(answer.status).toBe(200)
    await t.until(() => t.statusOf(id) === 'idle', '済み')
    expect(decisions).toEqual(['allow'])
    expect(t.sessions.all()[0]?.editCount).toBe(1)
    expect(t.sessions.messages(id).map((m) => m.body.kind)).toContain('approval_decision')
    // 2 度は答えられない（もう待ちが無い）。
    expect((await t.post(`/agent-sessions/${id}/approvals/${requestId}`, { decision: 'deny' }, { cookie: 'ixa_session=x' })).status).toBe(404)
  })

  it('「やめる」と答えると断る。直した数に数えない', async () => {
    const decisions: string[] = []
    const t = setup(generating(decisions))
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: '効果音を 1 本' })
    await t.until(() => t.statusOf(id) === 'awaiting_approval', '確認待ち')
    const request = t.sessions.messages(id).find((m) => m.body.kind === 'approval_request')?.body
    const requestId = request?.kind === 'approval_request' ? request.requestId : ''
    await t.post(`/agent-sessions/${id}/approvals/${requestId}`, { decision: 'deny' }, { cookie: 'ixa_session=x' })
    await t.until(() => t.statusOf(id) === 'idle', '済み')
    expect(decisions).toEqual(['deny'])
    expect(t.sessions.all()[0]?.editCount).toBe(0)
  })

  it('「以後このタスクでは確認しない」を選ぶと、旗を立てて帯の行を残し、次からは待たない', async () => {
    const decisions: string[] = []
    const t = setup(generating(decisions))
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: '1 本目' })
    await t.until(() => t.statusOf(id) === 'awaiting_approval', '確認待ち')
    const request = t.sessions.messages(id).find((m) => m.body.kind === 'approval_request')?.body
    const requestId = request?.kind === 'approval_request' ? request.requestId : ''
    await t.post(`/agent-sessions/${id}/approvals/${requestId}`, { decision: 'allow', waiveAfter: true }, { cookie: 'ixa_session=x' })
    await t.until(() => t.statusOf(id) === 'idle', '1 回目が済み')
    expect(t.sessions.all()[0]?.confirmationsWaived).toBe(true)
    expect(t.sessions.messages(id).some((m) => m.body.kind === 'system' && m.body.event === 'confirmations_waived')).toBe(true)

    await t.post(`/agent-sessions/${id}/messages`, { text: '2 本目' })
    await t.until(() => t.cli.calls.length === 2 && t.statusOf(id) === 'idle', '2 回目が済み')
    expect(decisions).toEqual(['allow', 'allow'])
    expect(t.sessions.messages(id).filter((m) => m.body.kind === 'approval_request')).toHaveLength(1)
  })

  it('読むだけ・ふつうの書き込みは待たない。ふつうの書き込みは直した数に数え、読むだけは数えない', async () => {
    const t = setup(async (call, app) => {
      const sessionId = call.mcpEnv()['IXA_AGENT_SESSION_ID'] ?? ''
      call.emit(cliLines.init(CLI_SESSION))
      for (const [toolUseId, toolName, risk] of [
        ['toolu_r', 'mcp__ixa__get_project', 'read'],
        ['toolu_w', 'mcp__ixa__edit_shots', 'write'],
      ] as const) {
        call.emit(cliLines.toolUse(CLI_SESSION, toolUseId, toolName, {}))
        expect(await approveVia(app, call, sessionId, { toolName, toolUseId, risk, input: {} })).toBe('allow')
        call.emit(cliLines.toolResult(CLI_SESSION, toolUseId, 'ok'))
      }
      call.emit(cliLines.result(CLI_SESSION, 0.1))
      return exited(0)
    })
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: '直して' })
    await t.until(() => t.statusOf(id) === 'idle', '済み')
    expect(t.sessions.all()[0]?.editCount).toBe(1)
    expect(t.sessions.messages(id).some((m) => m.body.kind === 'approval_request')).toBe(false)
  })

  it('会話の作品と違う projectId を触る操作は、印が読むだけでも削除と同じ扱いで確認する', async () => {
    const results: (string | null)[] = []
    const t = setup(async (call, app) => {
      const sessionId = call.mcpEnv()['IXA_AGENT_SESSION_ID'] ?? ''
      const auth = { authorization: `Bearer ${call.mcpToken()}`, 'content-type': 'application/json' }
      for (const projectId of ['01JQTHERPRJ000000000000000']) {
        const res = (await (
          await app.request(`/agent-sessions/${sessionId}/approvals`, {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({ toolName: 'mcp__ixa__get_project', toolUseId: `t-${projectId}`, risk: 'read', input: { projectId } }),
          })
        ).json()) as { data: { decision: string | null } }
        results.push(res.data.decision)
      }
      await call.untilStopped()
      return exited(143)
    })
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: '読んで' })
    await t.until(() => t.statusOf(id) === 'awaiting_approval', '確認待ち')
    expect(results).toEqual([null])
    const request = t.sessions.messages(id).find((m) => m.body.kind === 'approval_request')?.body
    expect(request).toMatchObject({ risk: 'destructive', toolName: 'mcp__ixa__get_project' })
    await t.post(`/agent-sessions/${id}/stop`, {})
    await t.until(() => t.statusOf(id) === 'interrupted', '中断')
  })

  it('会話の作品と同じ projectId なら、印のまま（読むだけはすぐ許す）', async () => {
    let decision: string | null = 'unset'
    const t = setup(async (call, app) => {
      const sessionId = call.mcpEnv()['IXA_AGENT_SESSION_ID'] ?? ''
      const projectId = call.invocation.stdin.match(/projectId: ([0-9A-Z]{26})/)?.[1] ?? ''
      const res = (await (
        await app.request(`/agent-sessions/${sessionId}/approvals`, {
          method: 'POST',
          headers: { authorization: `Bearer ${call.mcpToken()}`, 'content-type': 'application/json' },
          body: JSON.stringify({ toolName: 'mcp__ixa__get_project', toolUseId: 't1', risk: 'read', input: { projectId } }),
        })
      ).json()) as { data: { decision: string | null } }
      decision = res.data.decision
      return simpleTurn(call)
    })
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: '読んで' })
    await t.until(() => t.statusOf(id) === 'idle', '済み')
    expect(decision).toBe('allow')
  })

  it('1 時間答えが無ければ API がやめる扱いにして会話に残し、そのあとの「実行」は 409', async () => {
    const clock = { now: new Date('2026-10-23T00:00:00Z').getTime() }
    const states: (string | null)[] = []
    const t = setup(
      async (call, app) => {
        const sessionId = call.mcpEnv()['IXA_AGENT_SESSION_ID'] ?? ''
        const auth = { authorization: `Bearer ${call.mcpToken()}`, 'content-type': 'application/json' }
        const started = (await (
          await app.request(`/agent-sessions/${sessionId}/approvals`, {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({ toolName: 'mcp__ixa__export', toolUseId: 't1', risk: 'costly', input: {} }),
          })
        ).json()) as { data: { requestId: string } }
        clock.now += 60 * 60 * 1000 + 1
        const state = (await (
          await app.request(`/agent-sessions/${sessionId}/approvals/${started.data.requestId}`, { headers: auth })
        ).json()) as { data: { decision: string | null } }
        states.push(state.data.decision)
        await call.untilStopped()
        return exited(143)
      },
      { now: () => new Date(clock.now) },
    )
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: '書き出して' })
    await t.until(() => states.length === 1, '期限')
    expect(states).toEqual(['deny'])
    const decision = t.sessions.messages(id).find((m) => m.body.kind === 'approval_decision')?.body
    expect(decision).toMatchObject({ decision: 'deny', waiveAfter: false, by: 'timeout' })
    const request = t.sessions.messages(id).find((m) => m.body.kind === 'approval_request')?.body
    const requestId = request?.kind === 'approval_request' ? request.requestId : ''
    expect((await t.post(`/agent-sessions/${id}/approvals/${requestId}`, { decision: 'allow' }, { cookie: 'ixa_session=x' })).status).toBe(409)
    await t.post(`/agent-sessions/${id}/stop`, {})
    await t.until(() => t.statusOf(id) === 'interrupted', '中断')
  })

  it('状態を先に進めてから待ちを開ける（頼んだ直後は確認待ち、許しが見えた時は作業中）', async () => {
    const seen: { afterRequest?: string; afterAllow?: string } = {}
    const holder: { statusOf?: (id: AgentSession['id']) => string | undefined } = {}
    const t = setup(async (call, app) => {
      const sessionId = call.mcpEnv()['IXA_AGENT_SESSION_ID'] ?? ''
      const auth = { authorization: `Bearer ${call.mcpToken()}`, 'content-type': 'application/json' }
      const started = (await (
        await app.request(`/agent-sessions/${sessionId}/approvals`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ toolName: 'mcp__ixa__export', toolUseId: 't1', risk: 'costly', input: {} }),
        })
      ).json()) as { data: { requestId: string } }
      seen.afterRequest = holder.statusOf?.(sessionId as AgentSession['id'])
      for (;;) {
        const state = (await (
          await app.request(`/agent-sessions/${sessionId}/approvals/${started.data.requestId}`, { headers: auth })
        ).json()) as { data: { decision: string | null } }
        if (state.data.decision !== null) break
        await new Promise((resolve) => setTimeout(resolve, 2))
      }
      seen.afterAllow = holder.statusOf?.(sessionId as AgentSession['id'])
      call.emit(cliLines.result(CLI_SESSION, 0))
      return exited(0)
    }, {
      // 本物の DB と同じく、状態の書き込みに時間が掛かる。
      wrapSessions: (repo) => ({
        ...repo,
        transition: async (...args) => {
          await new Promise((resolve) => setTimeout(resolve, 30))
          return repo.transition(...args)
        },
      }),
    })
    holder.statusOf = t.statusOf
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: '書き出して' })
    await t.until(() => t.statusOf(id) === 'awaiting_approval', '確認待ち')
    const request = t.sessions.messages(id).find((m) => m.body.kind === 'approval_request')?.body
    const requestId = request?.kind === 'approval_request' ? request.requestId : ''
    await t.post(`/agent-sessions/${id}/approvals/${requestId}`, { decision: 'allow' }, { cookie: 'ixa_session=x' })
    await t.until(() => t.statusOf(id) === 'idle', '済み')
    expect(seen).toEqual({ afterRequest: 'awaiting_approval', afterAllow: 'running' })
  })

  it('このやりとりの鍵でなければ、確認の口は断る', async () => {
    const t = setup(async (call) => {
      await call.untilStopped()
      return exited(143)
    })
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: 'A' })
    await t.until(() => t.statusOf(id) === 'running', '作業中')
    const res = await t.post(
      `/agent-sessions/${id}/approvals`,
      { toolName: 'mcp__ixa__export', toolUseId: null, risk: 'costly', input: {} },
      { authorization: 'Bearer someone-elses-key' },
    )
    expect(res.status).toBe(403)
    await t.post(`/agent-sessions/${id}/stop`, {})
    await t.until(() => t.statusOf(id) === 'interrupted', '中断')
  })
})

describe('後片付けの失敗', () => {
  it('やりとりの後片付けで投げても、作業中のまま残さず失敗にする', async () => {
    const t = setup(simpleTurn, {
      wrapSessions: (repo) => ({ ...repo, recordTurn: () => Promise.reject(new Error('DB が落ちました')) }),
    })
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: 'こんにちは' })
    await t.until(() => t.statusOf(id) === 'error', '失敗')
    expect(t.tokens.rows()[0]?.revokedAt).not.toBeNull()
  })

  it('動いているやりとりが無いのに作業中のまま残った会話は、止めると中断にできる', async () => {
    const t = setup(simpleTurn)
    const id = await t.newTask()
    await t.sessions.transition(id, 'running', new Date())
    expect((await t.post(`/agent-sessions/${id}/stop`, {})).status).toBe(202)
    expect(t.statusOf(id)).toBe('interrupted')
    expect(t.sessions.messages(id).at(-1)?.body).toMatchObject({ kind: 'system', event: 'interrupted' })
  })
})

describe('確認なしへの切り替え', () => {
  it('Bearer の鍵（エージェント）からは旗を立てられない（403）。戻すのはよい', async () => {
    const t = setup(simpleTurn)
    const id = await t.newTask()
    const patch = (body: unknown) =>
      t.app.request(`/agent-sessions/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: 'Bearer some-agent-key' },
        body: JSON.stringify(body),
      })
    expect((await patch({ confirmationsWaived: true })).status).toBe(403)
    expect(t.sessions.all()[0]?.confirmationsWaived).toBe(false)
    expect((await patch({ confirmationsWaived: false })).status).toBe(200)
  })

  it('waive_confirmations の確認に「実行」と答えると、API が旗を立てて会話に残す', async () => {
    const t = setup(async (call, app) => {
      const sessionId = call.mcpEnv()['IXA_AGENT_SESSION_ID'] ?? ''
      const auth = { authorization: `Bearer ${call.mcpToken()}`, 'content-type': 'application/json' }
      const started = (await (
        await app.request(`/agent-sessions/${sessionId}/approvals`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ toolName: 'mcp__ixa__waive_confirmations', toolUseId: 'toolu_w', risk: 'settings', input: {} }),
        })
      ).json()) as { data: { requestId: string; decision: string | null } }
      expect(started.data.decision).toBeNull()
      await call.untilStopped()
      return exited(143)
    })
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: '確認なしでいい' })
    await t.until(() => t.statusOf(id) === 'awaiting_approval', '確認待ち')
    const request = t.sessions.messages(id).find((m) => m.body.kind === 'approval_request')?.body
    const requestId = request?.kind === 'approval_request' ? request.requestId : ''
    expect(t.sessions.all()[0]?.confirmationsWaived).toBe(false)
    await t.post(`/agent-sessions/${id}/approvals/${requestId}`, { decision: 'allow' }, { cookie: 'ixa_session=x' })
    expect(t.sessions.all()[0]?.confirmationsWaived).toBe(true)
    expect(t.sessions.messages(id).some((m) => m.body.kind === 'system' && m.body.event === 'confirmations_waived')).toBe(true)
    await t.post(`/agent-sessions/${id}/stop`, {})
    await t.until(() => t.statusOf(id) === 'interrupted', '中断')
  })
})

describe('残ったプロセスの後片付け', () => {
  it('やりとりの間は作業場所に CLI の番号を書き、終わったら消す', async () => {
    let seen: string | null = null
    const t = setup(async (call) => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      seen = readFileSync(join(call.invocation.cwd, 'cli.pid'), 'utf8')
      return simpleTurn(call)
    })
    const id = await t.newTask()
    await t.post(`/agent-sessions/${id}/messages`, { text: 'こんにちは' })
    await t.until(() => t.statusOf(id) === 'idle', '済み')
    await t.until(() => !existsSync(join(t.root, id, 'cli.pid')), '番号を消す')
    expect(seen).toBe('4242')
  })

  it('起動時に、残った番号のうちエージェントの CLI だけをグループごと止め、MCP の設定ファイルを消す', async () => {
    const t = setup(simpleTurn, { agentPids: [111] })
    for (const [dir, pid] of [['01JAAAAAAAAAAAAAAAAAAAAAAA', '111'], ['01JBBBBBBBBBBBBBBBBBBBBBBB', '222']] as const) {
      mkdirSync(join(t.root, dir), { recursive: true })
      writeFileSync(join(t.root, dir, 'cli.pid'), pid)
      writeFileSync(join(t.root, dir, 'mcp-x.json'), '{}')
    }
    await t.agent.recoverAfterRestart(new Date(Date.now() + 1000))
    expect(t.killed).toEqual([111])
    expect(existsSync(join(t.root, '01JAAAAAAAAAAAAAAAAAAAAAAA', 'mcp-x.json'))).toBe(false)
    expect(existsSync(join(t.root, '01JBBBBBBBBBBBBBBBBBBBBBBB', 'mcp-x.json'))).toBe(false)
    expect(existsSync(join(t.root, '01JAAAAAAAAAAAAAAAAAAAAAAA', 'cli.pid'))).toBe(false)
  })
})

describe('起動時の後片付け', () => {
  it('作業中・確認待ちのまま残った会話を中断にし、取り消し忘れのエージェントの鍵を取り消す', async () => {
    const t = setup(simpleTurn)
    const id = await t.newTask()
    await t.sessions.transition(id, 'running', new Date())
    await t.tokens.create({ kind: 'automation', label: `${AGENT_KEY_LABEL_PREFIX}A）`, tokenHash: 'h1', expiresAt: null })
    await t.tokens.create({ kind: 'automation', label: '制作者の MCP', tokenHash: 'h2', expiresAt: null })
    await t.agent.recoverAfterRestart(new Date(Date.now() + 1000))
    expect(t.statusOf(id)).toBe('interrupted')
    expect(t.sessions.messages(id).at(-1)?.body).toMatchObject({ kind: 'system', event: 'interrupted' })
    const revoked = t.tokens.rows().map((row) => [row.label, row.revokedAt !== null])
    expect(revoked).toEqual([
      [`${AGENT_KEY_LABEL_PREFIX}A）`, true],
      ['制作者の MCP', false],
    ])
    // 起動したあとに作った鍵（いま動いているやりとりの鍵）は取り消さない。
    await t.tokens.create({ kind: 'automation', label: `${AGENT_KEY_LABEL_PREFIX}B）`, tokenHash: 'h3', expiresAt: null })
    await t.agent.recoverAfterRestart(new Date(Date.now() - 60_000))
    expect(t.tokens.rows().find((row) => row.tokenHash === 'h3')?.revokedAt).toBeNull()
    // 中断した会話は続きから話せる。
    expect((await t.post(`/agent-sessions/${id}/messages`, { text: '続き' })).status).toBe(202)
    await t.until(() => t.statusOf(id) === 'idle', '済み')
  })
})

describe('直す・一覧', () => {
  it('確認なしの旗を戻すと、その行を会話に残す。一覧は作業中を上に寄せる', async () => {
    const t = setup(simpleTurn)
    const a = await t.newTask()
    const b = await t.newTask()
    const patch = (body: unknown) =>
      t.app.request(`/agent-sessions/${a}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: 'ixa_session=x' },
        body: JSON.stringify(body),
      })
    expect((await patch({ confirmationsWaived: true })).status).toBe(200)
    expect((await patch({ confirmationsWaived: false })).status).toBe(200)
    expect((await patch({})).status).toBe(422)
    expect(t.sessions.messages(a).map((m) => (m.body.kind === 'system' ? m.body.event : m.body.kind))).toEqual([
      'confirmations_waived',
      'confirmations_restored',
    ])
    await t.sessions.transition(a, 'running', new Date('2020-01-01T00:00:00Z'))
    const list = (await (await t.app.request(`/projects/${t.project.id}/agent-sessions`)).json()) as { data: { id: string }[] }
    expect(list.data.map((s) => s.id)).toEqual([a, b])
    expect(JSON.stringify(list)).not.toContain('cliSessionId')
  })
})
