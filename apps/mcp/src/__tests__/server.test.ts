import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { createServer, TOOLS } from '../server.js'
import { createFakeApi, depsFor, TOKEN, ulid } from './fake-api.js'

/** MCP の手順（初期化 → 一覧 → 呼び出し）を、本物の SDK のクライアントで通す。 */
const connect = async (fake: ReturnType<typeof createFakeApi>) => {
  const server = createServer(depsFor(fake))
  const client = new Client({ name: 'test', version: '0' })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return client
}

describe('MCP サーバ', () => {
  it('24 のツールを JSON Schema つきで出す', async () => {
    const client = await connect(createFakeApi([]))
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name))
    expect(tools).toHaveLength(30)
    const plan = tools.find((t) => t.name === 'plan_shots')
    expect(plan?.inputSchema.properties).toHaveProperty('boundariesSec')
    expect(plan?.inputSchema.required).toEqual(['projectId'])
    expect(plan?.description).toContain('17n+5')
    tools.forEach((t) => expect(t.description?.length).toBeGreaterThan(40))
  })

  it('呼び出しを API へ通し、短い JSON の text を返す', async () => {
    const PROJECT = ulid('PJ1')
    const fake = createFakeApi([
      { method: 'POST', path: `/projects/${PROJECT}/start-frames/generate`, status: 202, data: { jobIds: [], skipped: { drawing: 0, hasFrame: 1 } } },
    ])
    const client = await connect(fake)
    const result = await client.callTool({ name: 'draw_start_frames', arguments: { projectId: PROJECT, shotIds: [ulid('SH1')] } })
    expect(result.isError).toBeFalsy()
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('"skipped":{"drawing":0,"hasFrame":1}') as unknown },
    ])
  })

  it('入力の誤りと API の失敗は isError で返し、鍵を含めない', async () => {
    const fake = createFakeApi([{ method: 'GET', path: '/health', status: 401, data: '合言葉を入れてください' }])
    const client = await connect(fake)
    const invalid = await client.callTool({ name: 'get_project', arguments: { projectId: 'nope' } })
    expect(invalid.isError).toBe(true)
    const failed = await client.callTool({ name: 'ixa_status', arguments: {} })
    expect(failed.isError).toBe(true)
    expect(JSON.stringify(failed)).toContain('401')
    expect(JSON.stringify(failed)).toContain('合言葉を入れてください')
    expect(JSON.stringify(failed)).not.toContain(TOKEN)
  })
})
