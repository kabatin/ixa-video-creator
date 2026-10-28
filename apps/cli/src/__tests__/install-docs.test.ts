import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 結果の `docs`（`INSTALL.md#見出し`）が INSTALL.md の見出しを指し、そこで id が説明されているか。
 * 見出しを替えた・手順を足したのに書き忘れると、エージェントが読む先が無くなる（2026-10-28 のレビュー）。
 */

const SRC = new URL('..', import.meta.url).pathname
const INSTALL = readFileSync(new URL('../../../../INSTALL.md', import.meta.url), 'utf8')

const sourceFiles = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (name === '__tests__') return []
    return statSync(full).isDirectory() ? sourceFiles(full) : name.endsWith('.ts') ? [full] : []
  })

/** GitHub の見出しの印（小文字・空白は -・記号は落とす）。 */
const slugOf = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-')

const anchors = new Set(
  INSTALL.split('\n').flatMap((line) => {
    const heading = /^#{1,6}\s+(.+)$/.exec(line)?.[1]
    return heading === undefined ? [] : [slugOf(heading)]
  }),
)

/** 「任意」を指す setup の手順と doctor の点検（ADR-0065）。 */
const OPTIONAL_IDS = [
  'text-ai.claude',
  'text-ai.codex',
  'text-ai.grok',
  'text-ai.env',
  'env.gemini',
  'render.browser',
  'mcp.claude',
  'optional.claude',
  'optional.codex',
  'optional.grok',
  'tools.remotion-browser',
  'tools.japanese-font',
]

describe('INSTALL.md', () => {
  it('コードが指す見出しがどれもある', () => {
    const referenced = [...new Set(sourceFiles(SRC).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/INSTALL\.md#([^'"`)\s]+)/g)].map((m) => m[1] ?? '')))]
    expect(referenced.length).toBeGreaterThan(5)
    expect(referenced.filter((anchor) => !anchors.has(anchor))).toEqual([])
  })

  it('「任意」を指す手順と点検の id を、どれも INSTALL.md で説明している', () => {
    expect(OPTIONAL_IDS.filter((id) => !INSTALL.includes(`\`${id}\``))).toEqual([])
  })
})
