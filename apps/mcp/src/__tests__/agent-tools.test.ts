import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { waiveConfirmationsTool } from '../tools/agent.js'
import { AGENT_TOOLS, createServer, TOOLS } from '../server.js'
import { createFakeApi, depsFor, fakeClock, jsonOf, TOKEN, textOf, ulid } from './fake-api.js'

/**
 * AI エージェントの会話の中だけで使うツール（ADR-0058）。
 * - `approve`: Claude CLI の `--permission-prompt-tool`。CLI はツールを使う前にこれを呼び、
 *   `{behavior:"allow",updatedInput}` か `{behavior:"deny",message}` の JSON の text を受ける（CLI 2.1.289 で確かめた）。
 * - `waive_confirmations`: 制作者が「確認なしでいい」と言ったときに、そのタスクの旗を立てる。
 */

const SESSION = ulid('AS1')
const REQUEST = ulid('RQ1')
const decisionOf = (text: string): unknown => JSON.parse(text) as unknown
const approveTool = AGENT_TOOLS.find((t) => t.name === 'approve') ?? AGENT_TOOLS[0]!

describe('approve', () => {
  it('読むだけ・ふつうの書き込みも API に印を知らせる（API が直した数を数える）。API はすぐ許し、待たない', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/agent-sessions/${SESSION}/approvals`, data: { requestId: REQUEST, decision: 'allow', message: null } },
    ])
    const deps = depsFor(fake, { agentSessionId: SESSION })
    const result = await approveTool.run(
      { tool_name: 'mcp__ixa__edit_shots', input: { projectId: ulid('PJ1') }, tool_use_id: 'toolu_1' },
      deps,
    )
    expect(decisionOf(textOf(result))).toEqual({ behavior: 'allow', updatedInput: { projectId: ulid('PJ1') } })
    expect(fake.callsTo('POST', `/agent-sessions/${SESSION}/approvals`)[0]?.body).toMatchObject({ risk: 'write' })
    expect(fake.callsTo('GET', /approvals\//)).toHaveLength(0)
  })

  it('読むだけのツールは、API に届かなくても許す（読むだけなので止める理由が無い）', async () => {
    const fake = createFakeApi([{ method: 'POST', path: `/agent-sessions/${SESSION}/approvals`, status: 500, data: '壊れました' }])
    const result = await approveTool.run({ tool_name: 'mcp__ixa__get_project', input: {} }, depsFor(fake, { agentSessionId: SESSION }))
    expect(decisionOf(textOf(result))).toEqual({ behavior: 'allow', updatedInput: {} })
  })

  it('費用が掛かるものは API に確認を頼み、制作者の答えが来るまで待つ', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/agent-sessions/${SESSION}/approvals`, data: { requestId: REQUEST, decision: null, message: null } },
      {
        method: 'GET',
        path: `/agent-sessions/${SESSION}/approvals/${REQUEST}`,
        sequence: [
          { data: { decision: null, message: null } },
          { data: { decision: null, message: null } },
          { data: { decision: 'allow', message: null } },
        ],
      },
    ])
    const clock = fakeClock()
    const deps = depsFor(fake, { agentSessionId: SESSION, clock })
    const input = { projectId: ulid('PJ1'), cues: [{ startSec: 1, durationSec: 1, prompt: 'boom' }] }
    const result = await approveTool.run({ tool_name: 'mcp__ixa__generate_sfx', input, tool_use_id: 'toolu_9' }, deps)
    expect(decisionOf(textOf(result))).toEqual({ behavior: 'allow', updatedInput: input })
    expect(fake.callsTo('POST', `/agent-sessions/${SESSION}/approvals`)[0]?.body).toEqual({
      toolName: 'mcp__ixa__generate_sfx',
      toolUseId: 'toolu_9',
      risk: 'costly',
      input,
    })
    expect(fake.callsTo('GET', `/agent-sessions/${SESSION}/approvals/${REQUEST}`)).toHaveLength(3)
    expect(clock.slept.length).toBeGreaterThanOrEqual(2)
  })

  it('確認なしの旗が立っていれば、API がすぐ許す（待たない）', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/agent-sessions/${SESSION}/approvals`, data: { requestId: REQUEST, decision: 'allow', message: null } },
    ])
    const result = await approveTool.run(
      { tool_name: 'mcp__ixa__remove_sfx', input: { clipIds: [] } },
      depsFor(fake, { agentSessionId: SESSION }),
    )
    expect(decisionOf(textOf(result))).toEqual({ behavior: 'allow', updatedInput: { clipIds: [] } })
    expect(fake.callsTo('GET', /approvals\//)).toHaveLength(0)
  })

  it('やめると、理由つきで断る', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/agent-sessions/${SESSION}/approvals`, data: { requestId: REQUEST, decision: null, message: null } },
      { method: 'GET', path: `/agent-sessions/${SESSION}/approvals/${REQUEST}`, data: { decision: 'deny', message: null } },
    ])
    const result = await approveTool.run(
      { tool_name: 'mcp__ixa__export', input: {} },
      depsFor(fake, { agentSessionId: SESSION }),
    )
    const decision = decisionOf(textOf(result)) as { behavior: string; message: string }
    expect(decision.behavior).toBe('deny')
    expect(decision.message).toContain('やめる')
  })

  it('ixa 以外のツールは確認に回す（印が無いものは削除と同じ扱い）', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/agent-sessions/${SESSION}/approvals`, data: { requestId: REQUEST, decision: 'deny', message: '使えないツールです' } },
    ])
    const result = await approveTool.run({ tool_name: 'Bash', input: { command: 'ls' } }, depsFor(fake, { agentSessionId: SESSION }))
    expect(decisionOf(textOf(result))).toEqual({ behavior: 'deny', message: '使えないツールです' })
    expect(fake.callsTo('POST', /approvals$/)[0]?.body).toMatchObject({ risk: 'destructive' })
  })

  it('API に届かなければ断る（黙って許さない）。鍵は結果に出さない', async () => {
    const fake = createFakeApi([{ method: 'POST', path: `/agent-sessions/${SESSION}/approvals`, status: 500, data: '壊れました' }])
    const result = await approveTool.run({ tool_name: 'mcp__ixa__export', input: {} }, depsFor(fake, { agentSessionId: SESSION }))
    const decision = decisionOf(textOf(result)) as { behavior: string; message: string }
    expect(decision.behavior).toBe('deny')
    expect(textOf(result)).not.toContain(TOKEN)
  })

  it('長く答えが無ければ断る', async () => {
    const fake = createFakeApi([
      { method: 'POST', path: `/agent-sessions/${SESSION}/approvals`, data: { requestId: REQUEST, decision: null, message: null } },
      { method: 'GET', path: `/agent-sessions/${SESSION}/approvals/${REQUEST}`, data: { decision: null, message: null } },
    ])
    const result = await approveTool.run({ tool_name: 'mcp__ixa__export', input: {} }, depsFor(fake, { agentSessionId: SESSION }))
    expect((decisionOf(textOf(result)) as { behavior: string }).behavior).toBe('deny')
  })
})

describe('waive_confirmations', () => {
  it('そのタスクの確認なしの旗を立てる', async () => {
    const fake = createFakeApi([
      { method: 'PATCH', path: `/agent-sessions/${SESSION}`, data: { id: SESSION, confirmationsWaived: true } },
    ])
    const result = await waiveConfirmationsTool.run({}, depsFor(fake, { agentSessionId: SESSION }))
    expect(jsonOf(result)).toEqual({ confirmationsWaived: true })
    expect(fake.callsTo('PATCH', `/agent-sessions/${SESSION}`)[0]?.body).toEqual({ confirmationsWaived: true })
  })

  it('会話の外（agentSessionId が無い）では使えない', async () => {
    const result = await waiveConfirmationsTool.run({}, depsFor(createFakeApi([])))
    expect(result.isError).toBe(true)
  })
})

describe('登録', () => {
  const listNames = async (agentSessionId?: string) => {
    const deps = depsFor(createFakeApi([]), agentSessionId === undefined ? {} : { agentSessionId })
    const server = createServer(deps)
    const client = new Client({ name: 'test', version: '0' })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    return (await client.listTools()).tools.map((t) => t.name)
  }

  it('会話の中だけ、2 つのツールを足す', async () => {
    expect(await listNames()).toEqual(TOOLS.map((t) => t.name))
    expect(await listNames(SESSION)).toEqual([...TOOLS.map((t) => t.name), 'approve', 'waive_confirmations'])
  })
})
