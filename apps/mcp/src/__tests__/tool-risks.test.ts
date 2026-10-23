import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { AGENT_TOOLS, createServer, TOOL_RISKS, TOOLS } from '../server.js'
import { createFakeApi, depsFor, ulid } from './fake-api.js'

/**
 * 全ツールの危険度（ADR-0058）。AI エージェントのタブは、この印で「実行の前に制作者に確認するか」を決める。
 * **表で固定する。** ツールを足したら、ここにも足す（足さないと落ちる）。印を変えたら、ここも直す。
 */
const EXPECTED: Readonly<Record<string, string>> = {
  ixa_status: 'read',
  set_ai: 'settings',
  create_project: 'write',
  get_project: 'read',
  generate_music: 'costly',
  upload_music: 'write',
  set_master_track: 'settings',
  music_overview: 'read',
  plan_shots: 'write',
  edit_shots: 'write',
  create_character: 'write',
  create_location: 'write',
  draw_start_frames: 'costly',
  set_start_frame: 'write',
  list_start_frame_history: 'read',
  use_start_frame: 'write',
  retry_image: 'costly',
  view: 'read',
  generate_takes: 'costly',
  list_takes: 'read',
  adopt_take: 'write',
  review_take: 'costly',
  upscale_takes: 'costly',
  wait: 'read',
  add_effects: 'write',
  list_effects: 'read',
  remove_effects: 'destructive',
  analyze_motion: 'costly',
  suggest_sfx: 'read',
  generate_sfx: 'costly',
  list_sfx: 'read',
  remove_sfx: 'destructive',
  export: 'costly',
  export_thumbnail: 'costly',
  approve: 'read',
  waive_confirmations: 'settings',
}

describe('ツールの危険度', () => {
  it('全ツールの印が表のとおり', () => {
    const actual = Object.fromEntries([...TOOLS, ...AGENT_TOOLS].map((t) => [t.name, t.risk]))
    expect(actual).toEqual(EXPECTED)
  })

  it('引く表（TOOL_RISKS）も同じ印を持つ', () => {
    expect(Object.fromEntries(TOOL_RISKS)).toEqual(EXPECTED)
  })

  it('MCP の annotations に写す（読むだけ → readOnlyHint、削除 → destructiveHint）', async () => {
    const server = createServer(depsFor(createFakeApi([]), { agentSessionId: ulid('AS1') }))
    const client = new Client({ name: 'test', version: '0' })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    const { tools } = await client.listTools()
    const hints = Object.fromEntries(
      tools.map((t) => [t.name, [t.annotations?.readOnlyHint ?? null, t.annotations?.destructiveHint ?? null]]),
    )
    expect(hints['get_project']).toEqual([true, false])
    expect(hints['remove_sfx']).toEqual([false, true])
    expect(hints['generate_sfx']).toEqual([false, false])
    for (const [name, risk] of Object.entries(EXPECTED)) {
      expect(hints[name], name).toEqual([risk === 'read', risk === 'destructive'])
    }
  })
})
