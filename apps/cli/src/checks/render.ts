import path from 'node:path'
import type { RepoPaths } from '../lib/repo.js'
import type { RunResult, System } from '../system.js'
import type { CheckResult } from '../types.js'

/**
 * 書き出しの前提（ADR-0065）。Remotion の headless Chrome と、字幕・テロップの日本語フォント（ヒラギノ）。
 * どちらも無くても画面は開けるので ✗ にしない。**読むだけで何も取ってこない**（doctor）。
 */

export type BrowserState = 'ready' | 'missing' | 'unknown'

/** `packages/render/scripts/remotion-browser.ts` の終了コード（0 = ある、3 = 無い）。 */
export const browserStateOf = (r: RunResult): BrowserState => {
  if (r.kind !== 'completed') return 'unknown'
  if (r.exitCode === 0) return 'ready'
  return r.exitCode === 3 ? 'missing' : 'unknown'
}

/** 字幕の書体（`packages/render/src/compositions/text-style-css.ts`）が先に挙げるヒラギノ。macOS に入っている。 */
export const HIRAGINO_FONTS = [
  { label: 'ヒラギノ角ゴシック', file: 'ヒラギノ角ゴシック W3.ttc' },
  { label: 'ヒラギノ明朝', file: 'ヒラギノ明朝 ProN.ttc' },
  { label: 'ヒラギノ丸ゴ', file: 'ヒラギノ丸ゴ ProN W4.ttc' },
] as const

const SYSTEM_FONTS_DIR = '/System/Library/Fonts'

export type RenderFacts = {
  readonly browser: BrowserState
  /** Mac でなければ null（フォントの置き場が決まらない）。 */
  readonly missingFonts: readonly string[] | null
}

const DOCS = 'INSTALL.md#任意'

const browserCheck = (state: BrowserState): CheckResult => {
  const id = 'tools.remotion-browser'
  if (state === 'ready') return { id, group: 'tools', level: 'ok', message: '書き出しの headless Chrome があります' }
  if (state === 'unknown') {
    return { id, group: 'tools', level: 'skip', message: '書き出しの headless Chrome があるか確かめられませんでした（依存が入っていないかもしれません）' }
  }
  return {
    id,
    group: 'tools',
    level: 'warn',
    message: '書き出しの headless Chrome がまだありません。初めての書き出しのときに取ってきます（約 100 MB）',
    fix: { hint: '先に取ってくる', command: 'pnpm ixa setup', needsHuman: false },
    docs: DOCS,
  }
}

const fontCheck = (missing: readonly string[] | null): CheckResult => {
  const id = 'tools.japanese-font'
  if (missing === null) {
    return { id, group: 'tools', level: 'skip', message: '日本語フォント（ヒラギノ）は Mac でだけ確かめます' }
  }
  if (missing.length === 0) return { id, group: 'tools', level: 'ok', message: '字幕の日本語フォント（ヒラギノ）があります' }
  return {
    id,
    group: 'tools',
    level: 'warn',
    message: `字幕の日本語フォントが見つかりません（${missing.join('・')}）。書き出しでは別の書体になります`,
    fix: { hint: 'macOS のフォントを元に戻す（Font Book で「標準フォントを復元」）', needsHuman: true },
    docs: DOCS,
  }
}

/** 判定（純粋）。 */
export const judgeRender = (facts: RenderFacts): readonly CheckResult[] => [browserCheck(facts.browser), fontCheck(facts.missingFonts)]

/** headless Chrome があるか（取ってこない）。worker のディレクトリで見る（置き場がそこで決まる）。 */
export const remotionBrowserState = async (system: System, repo: RepoPaths): Promise<BrowserState> =>
  browserStateOf(
    await system.run(repo.cliTsx, [repo.remotionBrowserScript, 'status', repo.workerDir], { cwd: repo.root, timeoutMs: 30_000 }),
  )

export const gatherRender = async (system: System, repo: RepoPaths): Promise<RenderFacts> => {
  const browser = await remotionBrowserState(system, repo)
  if (system.platform !== 'darwin') return { browser, missingFonts: null }
  const present = await Promise.all(HIRAGINO_FONTS.map((font) => system.exists(path.join(SYSTEM_FONTS_DIR, font.file))))
  return { browser, missingFonts: HIRAGINO_FONTS.filter((_, i) => present[i] !== true).map((font) => font.label) }
}
