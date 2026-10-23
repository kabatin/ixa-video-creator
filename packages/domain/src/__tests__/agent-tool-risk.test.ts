import { describe, expect, it } from 'vitest'
import { approvalNeeded, countsAsEdit, ToolRisk, toolRisk } from '../index.js'

/**
 * AI エージェントのタブ（ADR-0058）。エージェントがする操作の危険度と、制作者に確認するか。
 * 生成・削除・書き出し・設定の変更の前には確認を出す。「確認なしでいい」と言われたら、そのタスクでは出さない。
 */

const RISKS = new Map<string, ToolRisk>([
  ['get_project', 'read'],
  ['edit_shots', 'write'],
  ['remove_sfx', 'destructive'],
  ['generate_sfx', 'costly'],
  ['set_ai', 'settings'],
])

describe('toolRisk', () => {
  it('CLI の名前（mcp__ixa__ の付いた形）から MCP の印を引く', () => {
    expect(toolRisk('mcp__ixa__get_project', RISKS)).toBe('read')
    expect(toolRisk('mcp__ixa__generate_sfx', RISKS)).toBe('costly')
  })

  it('印の無いツールは削除と同じ扱いにする（確認を出す側に倒す）', () => {
    expect(toolRisk('mcp__ixa__unknown_tool', RISKS)).toBe('destructive')
  })

  it('ixa 以外のツール（他の MCP・組み込みのツール）も削除と同じ扱い', () => {
    expect(toolRisk('Bash', RISKS)).toBe('destructive')
    expect(toolRisk('mcp__other__get_project', RISKS)).toBe('destructive')
    expect(toolRisk('get_project', RISKS)).toBe('destructive')
  })
})

describe('approvalNeeded', () => {
  const asking = { confirmationsWaived: false }
  const waived = { confirmationsWaived: true }

  it('読むだけ・ふつうの書き込みは確認しない', () => {
    expect(approvalNeeded('read', asking)).toBe(false)
    expect(approvalNeeded('write', asking)).toBe(false)
  })

  it('削除・費用が掛かるもの・設定の変更は確認する', () => {
    expect(approvalNeeded('destructive', asking)).toBe(true)
    expect(approvalNeeded('costly', asking)).toBe(true)
    expect(approvalNeeded('settings', asking)).toBe(true)
  })

  it('確認なしの旗が立っていれば、どれも確認しない', () => {
    for (const risk of ToolRisk.options) expect(approvalNeeded(risk, waived)).toBe(false)
  })
})

describe('countsAsEdit', () => {
  it('読むだけ以外を「直した数」に数える', () => {
    expect(countsAsEdit('read')).toBe(false)
    for (const risk of ['write', 'destructive', 'costly', 'settings'] as const) expect(countsAsEdit(risk)).toBe(true)
  })
})

describe('ToolRisk', () => {
  it('5 つの印のほかは受けない', () => {
    expect(ToolRisk.safeParse('dangerous').success).toBe(false)
  })
})
