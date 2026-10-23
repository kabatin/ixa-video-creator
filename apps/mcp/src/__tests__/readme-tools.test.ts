import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AGENT_TOOLS, TOOLS } from '../server.js'

/**
 * README のツールの数と一覧は、`TOOLS` を書き写したもの。書き写した規則は必ずずれる
 * （v0.7.0 で 34 本なのに「29」のまま、`analyze_motion` が一覧に無かった）ので、ここで突き合わせる。
 */
const README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')

describe('README のツール', () => {
  it('冒頭の本数が TOOLS の数と一致する', () => {
    const stated = /(\d+) のツールで扱う/.exec(README)?.[1]
    expect(Number(stated)).toBe(TOOLS.length)
  })

  it('「ツール」の節に、すべてのツールの名前がある', () => {
    const section = README.split('## ツール')[1] ?? ''
    const missing = TOOLS.map((t) => t.name).filter((name) => !section.includes(`\`${name}\``))
    expect(missing).toEqual([])
  })

  it('会話専用のツールも名前を挙げて説明している', () => {
    const missing = AGENT_TOOLS.map((t) => t.name).filter((name) => !README.includes(`\`${name}\``))
    expect(missing).toEqual([])
  })
})
