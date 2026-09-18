import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as compositionEntry from '../composition-entry.js'

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * ブラウザのバンドルに載せてはいけない物。
 *
 * `@remotion/renderer` / `@remotion/bundler` は Node 専用（子プロセス・ファイル書き込み）。
 * `@ixa/media` は ffprobe を起動する。`node:*` は説明不要。
 *
 * **完全一致ではなく前方一致で見る。** `node:fs/promises` のような派生を取り逃がさないため。
 */
const FORBIDDEN_PREFIXES = ['@remotion/renderer', '@remotion/bundler', '@ixa/media', 'node:']

/** import / export ... from '...' と、動的 import('...') の指定子を拾う。 */
const SPECIFIER_PATTERN = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g

const readSource = (filePath: string): string => readFileSync(filePath, 'utf8')

/**
 * ESM の `./foo.js` は実体が `./foo.ts` / `./foo.tsx`。
 * 解決できない相対指定子は**黙って飛ばさない**。見落としは検査の穴になる（L-015）。
 */
const resolveRelative = (fromFile: string, specifier: string): string => {
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), base]
  const found = candidates.find((candidate) => {
    try {
      readFileSync(candidate)
      return true
    } catch {
      return false
    }
  })
  if (found === undefined) {
    throw new Error(`相対 import を解決できなかった: ${specifier}（${fromFile}）`)
  }
  return found
}

const collectSpecifiers = (source: string): readonly string[] =>
  [...source.matchAll(SPECIFIER_PATTERN)].map((match) => match[1] as string)

/** エントリから到達できるファイルを辿り、外部パッケージの指定子を集める。 */
const walkImportGraph = (
  entry: string,
): { readonly files: readonly string[]; readonly externals: readonly string[] } => {
  const visited = new Set<string>()
  const externals = new Set<string>()
  const queue: string[] = [entry]

  while (queue.length > 0) {
    const current = queue.pop() as string
    if (visited.has(current)) continue
    visited.add(current)

    for (const specifier of collectSpecifiers(readSource(current))) {
      if (specifier.startsWith('.')) {
        queue.push(resolveRelative(current, specifier))
      } else {
        externals.add(specifier)
      }
    }
  }

  return { files: [...visited], externals: [...externals] }
}

describe('composition-entry の依存グラフ', () => {
  const graph = walkImportGraph(resolve(SRC_DIR, 'composition-entry.ts'))

  it('Node 専用のモジュールへ到達しない', () => {
    const forbidden = graph.externals.filter((specifier) =>
      FORBIDDEN_PREFIXES.some((prefix) => specifier.startsWith(prefix)),
    )
    expect(forbidden).toEqual([])
  })

  it('index.ts の Node 専用モジュールを取り込まない', () => {
    const nodeOnly = ['renderer.ts', 'bundle-cache.ts', 'ffmpeg-renderer.ts', 'ffmpeg-filters.ts']
    const reached = nodeOnly.filter((name) => graph.files.some((file) => file.endsWith(`/${name}`)))
    expect(reached).toEqual([])
  })

  /**
   * 検査そのものが働いていることを固定する。
   * 禁止語に触れる指定子を含むファイルを 1 つでも辿れば、必ず引っかかること。
   */
  it('禁止された指定子を見つけられる（検査自体の確認）', () => {
    const fromIndex = walkImportGraph(resolve(SRC_DIR, 'index.ts'))
    const forbidden = fromIndex.externals.filter((specifier) =>
      FORBIDDEN_PREFIXES.some((prefix) => specifier.startsWith(prefix)),
    )
    expect(forbidden).toContain('@remotion/renderer')
  })
})

describe('composition-entry の輸出', () => {
  it('プレビューに必要な名前をすべて輸出する', () => {
    expect(Object.keys(compositionEntry).sort()).toEqual([
      'ClipBody',
      'ClipMedia',
      'PRESET_SETTINGS',
      'TIMELINE_COMPOSITION_ID',
      'TRANSITION_SUPPORT',
      'TimelineComposition',
      'buildTimelinePlan',
      'frameRange',
      'letterboxFit',
      'presetResolution',
      'sourceOffsetFrames',
      'totalFrames',
    ])
  })

  it('コンポジション ID はレンダリング側と同じ値', () => {
    expect(compositionEntry.TIMELINE_COMPOSITION_ID).toBe('Timeline')
  })
})
