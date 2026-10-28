/**
 * `pnpm ixa doctor | setup` が呼ぶ入口（ADR-0065）。`tsx scripts/remotion-browser.ts <status|fetch> <worker のディレクトリ>`。
 *
 * - `status`: あれば終了コード 0、無ければ 3（**取ってこない**）
 * - `fetch`: 無ければ取ってくる（進み具合は stderr）。済めば 0
 *
 * 置き場は作業ディレクトリで決まるので、書き出す worker のディレクトリへ移ってから呼ぶ。
 */
import { fetchRemotionBrowser, remotionBrowserState } from '../src/browser.js'

const MISSING_EXIT_CODE = 3

const main = async (): Promise<number> => {
  const [mode, dir] = process.argv.slice(2)
  if ((mode !== 'status' && mode !== 'fetch') || dir === undefined) {
    process.stderr.write('使い方: remotion-browser.ts <status|fetch> <worker のディレクトリ>\n')
    return 2
  }
  process.chdir(dir)
  if (mode === 'status') return (await remotionBrowserState()) === 'ready' ? 0 : MISSING_EXIT_CODE
  let shown = -10
  await fetchRemotionBrowser((percent) => {
    if (percent < shown + 10 && percent !== 100) return
    shown = percent
    process.stderr.write(`headless Chrome を取ってきています… ${String(percent)}%\n`)
  })
  return 0
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  },
)
