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
  // 会話の作品の外を触る。別の作品を触るのと同じく確認する（レビュー 2026-10-23）。
  create_project: 'destructive',
  get_project: 'read',
  // 予算を変えるときは設定として確認する（呼び出しごとには riskOf。予算を含まなければ write）。
  update_project: 'settings',
  duplicate_project: 'destructive',
  import_from_project: 'destructive',
  generate_music: 'costly',
  upload_music: 'write',
  set_master_track: 'settings',
  music_overview: 'read',
  plan_shots: 'write',
  edit_shots: 'write',
  restructure_shots: 'destructive',
  draft_storyboard: 'costly',
  create_character: 'write',
  edit_character: 'destructive',
  create_location: 'write',
  edit_location: 'destructive',
  manage_brand_assets: 'destructive',
  draw_start_frames: 'costly',
  set_start_frame: 'write',
  list_start_frame_history: 'read',
  use_start_frame: 'write',
  retry_image: 'costly',
  view: 'read',
  generate_takes: 'costly',
  import_take: 'write',
  list_takes: 'read',
  adopt_take: 'write',
  review_take: 'costly',
  hide_takes: 'destructive',
  upscale_takes: 'costly',
  wait: 'read',
  cancel_jobs: 'destructive',
  align_to_music: 'write',
  add_telops: 'write',
  list_telops: 'read',
  edit_clips: 'write',
  remove_telops: 'destructive',
  // 読み辞書から外すのは戻せないので確認する（呼び出しごとには riskOf）。
  set_narration: 'destructive',
  speak_narration: 'costly',
  set_lyrics: 'write',
  add_effects: 'write',
  list_effects: 'read',
  remove_effects: 'destructive',
  analyze_motion: 'costly',
  suggest_sfx: 'read',
  generate_sfx: 'costly',
  upload_sfx: 'write',
  list_sfx: 'read',
  remove_sfx: 'destructive',
  edit_audio: 'write',
  export: 'costly',
  export_thumbnail: 'costly',
  list_edits: 'read',
  undo: 'destructive',
  approve: 'read',
  waive_confirmations: 'settings',
}

/**
 * 呼び出しごとの危険度（`riskOf`）。action で重さが変わるツールは、ふつうの直しで確認を出さない。
 * 静的な印（上の表）は「いちばん重い印」のまま。
 */
const PJ = ulid('PJ1')
const CALLS: readonly (readonly [string, Record<string, unknown>, string])[] = [
  ['edit_character', { projectId: PJ, characterId: ulid('CH1'), action: 'get' }, 'read'],
  ['edit_character', { projectId: PJ, characterId: ulid('CH1'), action: 'update', character: { displayName: '戦子' } }, 'write'],
  ['edit_character', { projectId: PJ, characterId: ulid('CH1'), action: 'delete' }, 'destructive'],
  ['edit_character', { projectId: PJ, characterId: ulid('CH1'), action: 'remove_identity_image', imageId: ulid('MG1') }, 'destructive'],
  ['edit_character', { projectId: PJ, characterId: ulid('CH1'), action: 'make_character_sheet' }, 'costly'],
  ['edit_location', { projectId: PJ, locationId: ulid('SP1'), action: 'update', name: '港' }, 'write'],
  ['edit_location', { projectId: PJ, locationId: ulid('SP1'), action: 'delete' }, 'destructive'],
  ['manage_brand_assets', { projectId: PJ, action: 'list' }, 'read'],
  ['manage_brand_assets', { projectId: PJ, action: 'update', brandAssetId: ulid('BA1'), name: 'ロゴ' }, 'write'],
  ['manage_brand_assets', { projectId: PJ, action: 'delete', brandAssetId: ulid('BA1') }, 'destructive'],
  ['review_take', { projectId: PJ, shotId: ulid('SH1'), takeId: ulid('TK1') }, 'costly'],
  ['review_take', { projectId: PJ, shotId: ulid('SH1'), takeId: ulid('TK1'), verdict: 'approved' }, 'write'],
  ['restructure_shots', { projectId: PJ, action: 'delete', shotIds: [ulid('SH1')] }, 'destructive'],
  ['restructure_shots', { projectId: PJ, action: 'insert', code: 'CUT12', startSec: 1, durationSec: 2 }, 'write'],
  ['restructure_shots', { projectId: PJ, action: 'split', shotId: ulid('SH1'), atSec: 1.5 }, 'write'],
  ['restructure_shots', { projectId: PJ, action: 'merge', shotIds: [ulid('SH1'), ulid('SH2')] }, 'write'],
  ['draft_storyboard', { projectId: PJ, action: 'latest' }, 'read'],
  ['draft_storyboard', { projectId: PJ, action: 'adopt', runId: ulid('RN1'), shotIds: [ulid('SH1')] }, 'write'],
  ['draft_storyboard', { projectId: PJ, action: 'draft' }, 'costly'],
  ['align_to_music', { projectId: PJ, action: 'plan' }, 'read'],
  ['align_to_music', { projectId: PJ, action: 'trim_music' }, 'write'],
  ['set_narration', { projectId: PJ, action: 'show' }, 'read'],
  ['set_narration', { projectId: PJ, action: 'reorder', lineIds: [ulid('NA1')] }, 'write'],
  ['set_narration', { projectId: PJ, action: 'readings', readings: { set: [{ written: '戦子', reading: 'せんこ' }] } }, 'write'],
  ['set_narration', { projectId: PJ, action: 'readings', readings: { remove: ['戦子'] } }, 'destructive'],
  ['update_project', { projectId: PJ, name: '新曲' }, 'write'],
  ['update_project', { projectId: PJ, budgetUsd: 10 }, 'settings'],
  // 入力が読めなければ静的な印に倒す（確認が出る側）。
  ['edit_character', { action: 'update' }, 'destructive'],
  ['review_take', { takeId: 'not-an-id', verdict: 'approved' }, 'costly'],
]

describe('ツールの危険度', () => {
  it('全ツールの印が表のとおり', () => {
    const actual = Object.fromEntries([...TOOLS, ...AGENT_TOOLS].map((t) => [t.name, t.risk]))
    expect(actual).toEqual(EXPECTED)
  })

  it('引く表（TOOL_RISKS）も同じ印を持つ', () => {
    expect(Object.fromEntries(TOOL_RISKS)).toEqual(EXPECTED)
  })

  it.each(CALLS)('%s %j → %s', (name, input, risk) => {
    const tool = TOOLS.find((t) => t.name === name)
    expect(tool?.riskOf(input)).toBe(risk)
  })

  it('approve は呼び出しごとの印を API に知らせる', async () => {
    const SESSION = ulid('AS1')
    const fake = createFakeApi([
      { method: 'POST', path: `/agent-sessions/${SESSION}/approvals`, data: { requestId: ulid('RQ1'), decision: 'allow', message: null } },
    ])
    const approve = AGENT_TOOLS.find((t) => t.name === 'approve')
    const deps = depsFor(fake, { agentSessionId: SESSION })
    for (const [name, input] of CALLS) await approve?.run({ tool_name: `mcp__ixa__${name}`, input }, deps)
    const sent = fake.callsTo('POST', `/agent-sessions/${SESSION}/approvals`).map((c) => (c.body as { risk: string }).risk)
    expect(sent).toEqual(CALLS.map(([, , risk]) => risk))
  })

  it('呼び出しごとの印は、静的な印より重くならない', () => {
    const order = ['read', 'write', 'settings', 'costly', 'destructive']
    for (const [name, input] of CALLS) {
      const tool = TOOLS.find((t) => t.name === name)
      if (tool === undefined) throw new Error(name)
      if (tool.risk === 'destructive') continue
      expect(order.indexOf(tool.riskOf(input)), name).toBeLessThanOrEqual(order.indexOf(tool.risk))
    }
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
