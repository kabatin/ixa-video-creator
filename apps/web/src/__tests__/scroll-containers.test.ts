import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **スクロールする箱は、中の絶対配置の基準にする**（`relative` などを持たせる）。
 *
 * 持たせないと、読み上げ用に隠した文字（`sr-only` は `position: absolute`）が箱の外の
 * 祖先を基準に置かれ、スクロールの下の方にあるぶんだけ外へはみ出す。インスペクターでは
 * 外側（Dockview の枠）まで伸びて、スクロールバーが 2 本出た（2026-09-28、Windows の
 * Chrome で制作者が指摘。スクロールバーが常に出る環境でだけ目に見える）。
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))

const sourceFiles = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path)
    return name.endsWith('.tsx') ? [path] : []
  })

const SCROLLS_VERTICALLY = /(?:^|[\s'"`])overflow-(?:y-)?auto(?:$|[\s'"`])/
const POSITIONED = /(?:^|[\s'"`])(?:relative|absolute|fixed|sticky)(?:$|[\s'"`])/

/** `path:line  該当` の一覧。空なら合格。 */
const unpositionedScrollers = (): readonly string[] =>
  sourceFiles(SRC).flatMap((path) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        SCROLLS_VERTICALLY.test(line) && !POSITIONED.test(line)
          ? [`${relative(SRC, path)}:${String(index + 1)}  ${line.trim()}`]
          : [],
      ),
  )

describe('スクロールする箱', () => {
  it('縦にスクロールする箱は、位置の基準を持つ（中の sr-only が外へはみ出さない）', () => {
    expect(unpositionedScrollers()).toEqual([])
  })

  it('検査そのものが当たる（素通りしていない）', () => {
    expect(SCROLLS_VERTICALLY.test('className="min-h-0 flex-1 overflow-auto"')).toBe(true)
    expect(POSITIONED.test('className="min-h-0 flex-1 overflow-auto"')).toBe(false)
    expect(POSITIONED.test('className="relative min-h-0 flex-1 overflow-auto"')).toBe(true)
  })
})
