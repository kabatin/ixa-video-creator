import { describe, expect, it } from 'vitest'
import { formatChecks, formatStep, summarize } from '../printer.js'
import type { CheckResult } from '../types.js'

const results: readonly CheckResult[] = [
  { id: 'tools.node', group: 'tools', level: 'ok', message: 'Node 22.11.0' },
  {
    id: 'tools.ffmpeg',
    group: 'tools',
    level: 'fail',
    message: 'FFmpeg が入っていません',
    fix: { hint: 'Homebrew で入れる', command: 'brew install ffmpeg', needsHuman: true },
  },
  { id: 'env.file', group: 'env', level: 'ok', message: '.env があります', fix: { hint: '出ない', needsHuman: false } },
]

describe('printer', () => {
  it('群ごとに見出し、✗ と ! だけに直し方を 1 行添える', () => {
    const text = formatChecks(results)
    expect(text.split('\n')).toEqual([
      '道具',
      '  ✓ Node 22.11.0',
      '  ✗ FFmpeg が入っていません',
      '      直し方: brew install ffmpeg  … Homebrew で入れる［人の操作・同意が要る］',
      '',
      '設定',
      '  ✓ .env があります',
    ])
  })

  it('まとめは ✗ の数で変わる', () => {
    expect(summarize(results)).toContain('直すところがあります（✗ 1')
    expect(summarize(results.filter((r) => r.level === 'ok'))).toContain('使えます')
  })

  it('手順の「済み」には直し方を出さない', () => {
    expect(formatStep({ id: 'x', status: 'already', message: '.env があります', fix: { hint: 'h', needsHuman: false } })).toBe('✓ .env があります（済み）')
    expect(formatStep({ id: 'x', status: 'needs_human', message: 'Docker がありません', fix: { hint: '入れてもらう', needsHuman: true } })).toContain('直し方')
  })
})
