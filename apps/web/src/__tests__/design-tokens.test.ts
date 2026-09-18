import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **色は役割の名前で持つ**（PHASE 5.9）。
 *
 * `slate-600` のような素の色名が部品に残っていると、ダークとライトの切り替えで
 * その箇所だけ取り残される。実際にダークを既定にした直後、カードだけが白いまま残った。
 * 役割の名前（`bg-surface` / `text-muted` / `border-line` …）だけを使うことを、
 * ソースを走査して固定する。**対応表は `tasks/todo.md` PHASE 5.9 にある。**
 *
 * 例外は `globals.css`（トークンの定義そのもの）だけ。テストは走査対象に入れない。
 */

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url))

const RAW_PALETTE =
  /\b(?:bg|text|border|ring|outline|divide|from|via|to|accent|fill|stroke|shadow|placeholder|caret|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/\d{1,3})?\b/g

const walk = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full)
    return /\.(?:ts|tsx)$/.test(name) ? [full] : []
  })

type Hit = { readonly file: string; readonly line: number; readonly text: string }

const findRawPalette = (): readonly Hit[] =>
  walk(SRC_DIR).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((text, index) => {
        const matches = text.match(RAW_PALETTE)
        return matches === null
          ? []
          : [{ file: file.slice(SRC_DIR.length), line: index + 1, text: matches.join(' ') }]
      }),
  )

describe('デザイントークン', () => {
  it('部品に素の色名（slate-600 など）が残っていない', () => {
    const hits = findRawPalette()
    const report = hits
      .slice(0, 40)
      .map((hit) => `${hit.file}:${String(hit.line)}  ${hit.text}`)
      .join('\n')

    expect(hits, `役割の名前へ置き換えてください（先頭 40 件）:\n${report}`).toEqual([])
  })
})
