import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 密度の尺度（UI-WORKBENCH §5 / §10）。
 *
 * 文字と高さは rem か Tailwind の尺度だけで書く。**素の px を書くと、環境設定で
 * 文字を大きくしたときにそこだけ伸びない。** 以前は `text-[10px]` が 6 箇所あった。
 *
 * `faint` は 12px 未満では使わない（`globals.css` の規則）。`text-xs` は 11px なので、
 * 同じ class 文字列に `text-xs` と `text-faint` が並んでいたら落とす。
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))

const sourceFiles = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })

const FILES = sourceFiles(SRC)

/** `path:line  該当` の一覧。空なら合格。 */
const findAll = (pattern: RegExp): readonly string[] =>
  FILES.flatMap((path) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        pattern.test(line) ? [`${relative(SRC, path)}:${String(index + 1)}  ${line.trim()}`] : [],
      ),
  )

const PX_TEXT = /(?:^|[\s'"`])text-\[\d+(?:\.\d+)?px\]/
const PX_HEIGHT = /(?:^|[\s'"`:])(?:min-|max-)?h-\[\d+(?:\.\d+)?px\]/
/** 1 つの文字列リテラルの中に `text-xs` と `text-faint` の両方がある。 */
const XS_WITH_FAINT =
  /(['"`])(?:(?!\1).)*(?:\btext-xs\b(?:(?!\1).)*\btext-faint\b|\btext-faint\b(?:(?!\1).)*\btext-xs\b)(?:(?!\1).)*\1/

describe('密度の尺度', () => {
  it('走査の対象が空ではない（空なら何も見ていない）', () => {
    expect(FILES.length).toBeGreaterThan(100)
  })

  it('text-[..px] が無い', () => {
    expect(findAll(PX_TEXT)).toEqual([])
  })

  it('h-[..px] / min-h-[..px] / max-h-[..px] が無い', () => {
    expect(findAll(PX_HEIGHT)).toEqual([])
  })

  it('text-xs と text-faint が同じ要素に無い', () => {
    expect(findAll(XS_WITH_FAINT)).toEqual([])
  })

  /** 検査そのものが当たることを固定する（L-026〜L-029: 素通りする検査を作らない）。 */
  it.each([
    ['text', PX_TEXT, `className="text-[10px] text-muted"`],
    ['height', PX_HEIGHT, `className="min-h-[680px]"`],
    ['xs+faint', XS_WITH_FAINT, `className="text-xs text-faint"`],
    ['faint+xs', XS_WITH_FAINT, `'text-faint px-2 text-xs'`],
  ])('%s の検査は違反に当たる', (_label, pattern, sample) => {
    expect(pattern.test(sample)).toBe(true)
  })

  it.each([
    [PX_TEXT, `className="text-xs"`],
    [PX_HEIGHT, `className="h-7 min-h-[1.75rem]"`],
    [XS_WITH_FAINT, `className="text-xs text-muted" title="text-faint"`],
  ])('正しい書き方には当たらない: %s', (pattern, sample) => {
    expect(pattern.test(sample)).toBe(false)
  })
})
