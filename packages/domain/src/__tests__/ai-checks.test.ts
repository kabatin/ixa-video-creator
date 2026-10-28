import { describe, expect, it } from 'vitest'
import { AI_CHECKS_OFF, AiChecks, aiCheckGate } from '../ai/ai-checks.js'
import { AiSettings } from '../ai/ai-tools.js'

/**
 * AI のチェック（ADR-0066。制作者 2026-10-28「トークン消費激しすぎるから、切り替え可能にしてデフォルトは OFF」）。
 * 絵と Take を Claude が見るか。既定は切る。入れても文章の AI が Claude のときだけ見る。
 */

const TOOLS = { text: 'stub', image: 'stub', video: 'stub', voice: 'stub', transcribe: 'stub', music: 'stub', sfx: 'stub' } as const

describe('AiSettings の checks', () => {
  it('省けばどちらも切る（チェックを知らない前の保存・画面から来ても、勝手に入れない）', () => {
    expect(AiSettings.parse(TOOLS).checks).toEqual({ image: false, video: false })
  })

  it('入れた値をそのまま持つ', () => {
    expect(AiSettings.parse({ ...TOOLS, checks: { image: true, video: false } }).checks).toEqual({ image: true, video: false })
  })

  it('真偽以外は受けない', () => {
    expect(AiSettings.safeParse({ ...TOOLS, checks: { image: 'yes', video: false } }).success).toBe(false)
    expect(AiSettings.safeParse({ ...TOOLS, checks: { image: true, video: 1 } }).success).toBe(false)
  })

  it('片方だけでは受けない（どちらかを黙って切らない）', () => {
    expect(AiChecks.safeParse({ image: true }).success).toBe(false)
    expect(AiSettings.safeParse({ ...TOOLS, checks: { video: true } }).success).toBe(false)
  })

  it('既定の値は変えられない', () => {
    expect(Object.isFrozen(AI_CHECKS_OFF)).toBe(true)
    expect(AI_CHECKS_OFF).toEqual({ image: false, video: false })
  })
})

describe('aiCheckGate', () => {
  const both = { image: true, video: true }

  it('切っていれば、文章の AI が Claude でも見ない', () => {
    expect(aiCheckGate({ text: 'claude_cli', checks: AI_CHECKS_OFF }, 'image')).toBe('off')
    expect(aiCheckGate({ text: 'claude_cli', checks: AI_CHECKS_OFF }, 'video')).toBe('off')
  })

  it('入れていて文章の AI が Claude なら Claude で見る', () => {
    expect(aiCheckGate({ text: 'claude_cli', checks: both }, 'image')).toBe('claude')
    expect(aiCheckGate({ text: 'claude_cli', checks: both }, 'video')).toBe('claude')
  })

  it('入れていても、文章の AI が Claude でなければ見ない（画像を見られる口は Claude だけ）', () => {
    expect(aiCheckGate({ text: 'codex_cli', checks: both }, 'image')).toBe('not_claude')
    expect(aiCheckGate({ text: 'stub', checks: both }, 'video')).toBe('not_claude')
  })

  it('絵と Take は別々に切り替わる', () => {
    expect(aiCheckGate({ text: 'claude_cli', checks: { image: true, video: false } }, 'image')).toBe('claude')
    expect(aiCheckGate({ text: 'claude_cli', checks: { image: true, video: false } }, 'video')).toBe('off')
    expect(aiCheckGate({ text: 'claude_cli', checks: { image: false, video: true } }, 'image')).toBe('off')
    expect(aiCheckGate({ text: 'claude_cli', checks: { image: false, video: true } }, 'video')).toBe('claude')
  })
})
